import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Store, type UserRow } from './db.js';
import type { Config } from './config.js';
import { normalizeBasePath } from './config.js';
import { AppError, token, digest, equal, verifyPassword, hashPassword } from './security.js';
import { TelegramBridge } from './telegram.js';
import { readCatalog } from './content.js';
import { accessibleCatalog } from './content-access.js';
import { SESSION_TTL_MS } from './session-policy.js';
interface Auth { user: UserRow; session: string; csrf: string; }
declare global { namespace Express { interface Request { auth?: Auth; } } }
const passwordSchema = z.string().min(12).max(128);
const emailSchema = z.email().max(254).transform(s => s.toLowerCase());
const credentials = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
const recentSchema = z.object({ password: z.string().min(1).max(128) });
const publicUser = (u: UserRow) => ({ id: u.id, name: u.name, email: u.email, telegramConnected: !!u.telegram, telegramName: u.telegram_name, created: u.created });

export function createApp(config: Config, store = new Store(config.dbPath), bridge = new TelegramBridge(config, store)) {
  const app = express(); app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy || false);
  const cookiePath = normalizeBasePath(config.basePath);
  const cookieName = config.production ? (cookiePath === '/' ? '__Host-u7' : '__Secure-u7-web') : 'u7_session';
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'self'"],
    upgradeInsecureRequests: config.production ? [] : null,
  } }, strictTransportSecurity: config.production ? { maxAge: 31536000 } : false, referrerPolicy: { policy: 'no-referrer' } }));
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.headers.host !== new URL(config.origin).host) return res.status(403).json({ error: 'Недопустимый адрес сервиса', code: 'HOST' });
    next();
  });
  // Keep API and static routes inside the same configured URL prefix.
  if (cookiePath !== '/') app.use((req, res, next) => {
    const prefix = cookiePath.slice(0, -1);
    if (req.path === prefix) return res.redirect(308, cookiePath);
    if (!req.path.startsWith(cookiePath)) return res.status(404).json({ error: 'Страница не найдена', code: 'NOT_FOUND' });
    req.url = req.url.slice(prefix.length);
    next();
  });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Слишком много запросов. Подождите минуту.' } }));
  app.use('/api', express.json({ limit: '12kb', strict: true }));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin !== config.origin || req.headers['x-u7-request'] !== '1' || !req.is('application/json')) return next(new AppError(403, 'CSRF', 'Запрос отклонён. Обновите страницу.'));
    }
    next();
  });
  function setSession(res: Response, user: UserRow) {
    const raw = token(), csrf = token(), now = Date.now();
    store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run(digest(raw), user.id, csrf, now, now, now + SESSION_TTL_MS);
    res.cookie(cookieName, raw, { httpOnly: true, secure: config.production, sameSite: 'strict', path: cookiePath, maxAge: SESSION_TTL_MS });
    return csrf;
  }
  function clearSession(res: Response) { res.clearCookie(cookieName, { httpOnly: true, secure: config.production, sameSite: 'strict', path: cookiePath }); }
  async function reauth(req: Request) {
    const u = req.auth!.user, body = recentSchema.parse(req.body);
    if (config.production && !store.attempt(`reauth:${u.id}`, 8, 15 * 60_000)) throw new AppError(429, 'RATE_LIMIT', 'Слишком много попыток. Повторите через 15 минут.');
    if (!await verifyPassword(body.password, u.password)) throw new AppError(401, 'AUTH_FAILED', 'Неверный пароль кабинета.');
  }
  app.get('/api/public', (_req, res) => res.json({ bot: config.bot, telegramConfigured: bridge.configured, catalog: accessibleCatalog(readCatalog()) }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  const authLimiter = rateLimit({ skip: () => !config.production, windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Слишком много попыток входа. Повторите через 15 минут.' } });
  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const body = credentials.parse(req.body);
    if (config.production && !store.attempt(`login:${digest(body.email)}`, 12, 15 * 60_000)) throw new AppError(429, 'RATE_LIMIT', 'Слишком много попыток. Повторите через 15 минут.');
    const user = store.email(body.email);
    const valid = await verifyPassword(body.password, user?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if (!user || !valid) throw new AppError(401, 'AUTH_FAILED', 'Неверная почта или пароль.');
    store.audit(user.id, 'auth.login');
    res.json({ user: publicUser(user), csrf: setSession(res, user) });
  });
  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const body = z.object({ email: emailSchema, name: z.string().trim().min(2).max(70), password: passwordSchema }).strict().parse(req.body);
    if (store.email(body.email)) throw new AppError(400, 'REGISTER_FAILED', 'Не удалось создать кабинет. Проверьте почту.');
    const password = await hashPassword(body.password), id = randomUUID();
    store.db.exec('BEGIN IMMEDIATE');
    try {
      store.db.prepare('INSERT INTO users(id,email,name,password,created) VALUES(?,?,?,?,?)').run(id, body.email, body.name, password, Date.now());
      store.db.exec('COMMIT');
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
    const user = store.user(id)!; store.audit(id, 'auth.register'); res.json({ user: publicUser(user), csrf: setSession(res, user) });
  });
  app.use('/api', (req, res, next) => {
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!cookie || !/^[\w-]{43}$/.test(cookie)) return next(new AppError(401, 'LOGIN_REQUIRED', 'Войдите в личный кабинет.'));
    const hash = digest(cookie), now = Date.now();
    const s = store.db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(hash, now);
    if (!s) return next(new AppError(401, 'LOGIN_REQUIRED', 'Сессия истекла. Войдите снова.'));
    const user = store.user(String(s.user_id));
    if (!user) return next(new AppError(401, 'LOGIN_REQUIRED', 'Войдите снова.'));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !equal(String(req.headers['x-csrf-token'] || ''), String(s.csrf))) return next(new AppError(403, 'CSRF', 'Запрос отклонён. Обновите страницу.'));
    req.auth = { user, session: hash, csrf: String(s.csrf) };
    store.db.prepare('UPDATE sessions SET touched=?,expires=MAX(expires,?) WHERE hash=?').run(now, now + SESSION_TTL_MS, hash);
    res.cookie(cookieName, cookie, { httpOnly: true, secure: config.production, sameSite: 'strict', path: cookiePath, maxAge: SESSION_TTL_MS });
    next();
  });
  app.get('/api/me', (req, res) => res.json({ user: publicUser(req.auth!.user), csrf: req.auth!.csrf }));
  app.post('/api/auth/logout', async (req, res) => {
    const { user, session } = req.auth!; store.db.prepare('DELETE FROM sessions WHERE hash=?').run(session);
    await bridge.cancel(user.id, session); clearSession(res); res.json({ ok: true });
  });
  app.patch('/api/profile', (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(2).max(70) }).strict().parse(req.body);
    store.db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.auth!.user.id); res.json({ user: publicUser(store.user(req.auth!.user.id)!) });
  });
  app.post('/api/auth/password', async (req, res) => {
    const { newPassword } = z.object({ newPassword: passwordSchema }).parse(req.body); await reauth(req);
    const user = req.auth!.user;
    store.db.prepare('UPDATE users SET password=? WHERE id=?').run(await hashPassword(newPassword), user.id);
    store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id); store.audit(user.id, 'auth.password.changed'); clearSession(res); res.json({ ok: true });
  });
  app.get('/api/security', (req, res) => {
    const { user, session } = req.auth!;
    res.json({ sessions: store.db.prepare('SELECT hash,created,touched,expires FROM sessions WHERE user_id=? AND expires>?').all(user.id, Date.now()).map(s => ({ id: digest(String(s.hash)), current: s.hash === session, created: s.created, touched: s.touched, expires: s.expires })), audit: store.db.prepare('SELECT action,created FROM audit WHERE user_id=? ORDER BY id DESC LIMIT 30').all(user.id) });
  });
  app.post('/api/security/revoke-others', async (req, res) => { await reauth(req); store.db.prepare('DELETE FROM sessions WHERE user_id=? AND hash<>?').run(req.auth!.user.id, req.auth!.session); store.audit(req.auth!.user.id, 'auth.sessions.revoked'); res.json({ ok: true }); });
  app.post('/api/telegram/qr/start', async (req, res) => {
    await reauth(req);
    if (config.production && !store.attempt(`tg-login:${req.auth!.user.id}`, 4, 30 * 60_000)) throw new AppError(429, 'RATE_LIMIT', 'Слишком много подключений. Повторите позже.');
    res.json(await bridge.exclusive(req.auth!.user.id, () => bridge.beginQr(req.auth!.user.id, req.auth!.session)));
  });
  app.post('/api/telegram/qr/status', async (req, res) => {
    const { attempt } = z.object({ attempt: z.string().regex(/^[\w-]{43}$/) }).strict().parse(req.body);
    res.json(await bridge.exclusive(req.auth!.user.id, () => bridge.qrStatus(req.auth!.user.id, req.auth!.session, attempt)));
  });
  app.post('/api/telegram/connect', async (req, res) => {
    const { phone } = z.object({ phone: z.string().regex(/^\+[1-9]\d{7,14}$/) }).parse(req.body); await reauth(req);
    if (config.production && !store.attempt(`tg-login:${req.auth!.user.id}`, 4, 30 * 60_000)) throw new AppError(429, 'RATE_LIMIT', 'Слишком много запросов кода. Повторите через 30 минут.');
    res.json(await bridge.exclusive(req.auth!.user.id, () => bridge.begin(req.auth!.user.id, req.auth!.session, phone)));
  });
  app.post('/api/telegram/resend', async (req, res) => {
    res.json(await bridge.exclusive(req.auth!.user.id, () => bridge.resend(req.auth!.user.id, req.auth!.session)));
  });
  app.post('/api/telegram/verify', async (req, res) => {
    const { code, password } = z.object({ code: z.string().regex(/^\d{4,8}$/).optional(), password: z.string().min(1).max(256).optional() }).strict().parse(req.body);
    if (config.production && !store.attempt(`tg-code:${req.auth!.user.id}`, 8, 15 * 60_000)) throw new AppError(429, 'RATE_LIMIT', 'Слишком много попыток.');
    res.json(await bridge.exclusive(req.auth!.user.id, () => bridge.finish(req.auth!.user.id, req.auth!.session, code, password)));
  });
  app.post('/api/telegram/cancel', async (req, res) => { await bridge.exclusive(req.auth!.user.id, () => bridge.cancel(req.auth!.user.id, req.auth!.session)); res.json({ ok: true }); });
  app.get('/api/learning', async (req, res) => {
    const progress = await bridge.exclusive(req.auth!.user.id, () => bridge.learning(req.auth!.user.id, req.auth!.session));
    res.json({ ...progress, catalog: accessibleCatalog(readCatalog(), progress) });
  });
  app.post('/api/learning/complete', async (req, res) => {
    const { stepId } = z.object({ stepId: z.string().regex(/^[a-f0-9-]{36}$/i) }).strict().parse(req.body);
    const progress = await bridge.exclusive(req.auth!.user.id, () => bridge.completeLearningStep(req.auth!.user.id, req.auth!.session, stepId));
    res.json({ ...progress, catalog: accessibleCatalog(readCatalog(), progress) });
  });
  app.get('/api/telegram/messages', async (req, res) => { res.json({ messages: await bridge.exclusive(req.auth!.user.id, () => bridge.messages(req.auth!.user.id, req.auth!.session)), syncedAt: Date.now() }); });
  app.post('/api/telegram/click', async (req, res) => {
    const { ticket } = z.object({ ticket: z.string().regex(/^[\w-]{43}$/) }).strict().parse(req.body);
    if (!store.attempt(`tg-click:${req.auth!.user.id}`, 20, 60_000)) throw new AppError(429, 'RATE_LIMIT', 'Подождите перед следующим нажатием.');
    res.json(await bridge.exclusive(req.auth!.user.id, () => bridge.click(req.auth!.user.id, req.auth!.session, ticket)));
  });
  app.post('/api/telegram/message', async (req, res) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    if (!store.attempt(`tg-message:${req.auth!.user.id}`, 12, 60_000)) throw new AppError(429, 'RATE_LIMIT', 'Подождите перед отправкой следующего сообщения.');
    res.json(await bridge.exclusive(req.auth!.user.id, () => bridge.send(req.auth!.user.id, text)));
  });
  app.post('/api/telegram/disconnect', async (req, res) => { await reauth(req); await bridge.exclusive(req.auth!.user.id, () => bridge.disconnect(req.auth!.user.id)); res.json({ ok: true }); });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Метод не найден', code: 'NOT_FOUND' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Проверьте заполненные поля.', code: 'VALIDATION' });
    const message = error instanceof Error ? error.message : '';
    if (/PHONE_CODE_INVALID|PHONE_CODE_EXPIRED|PASSWORD_HASH_INVALID|PHONE_NUMBER_INVALID/.test(message)) return res.status(400).json({ error: 'Неверный или истёкший код, телефон или пароль Telegram.', code: 'TELEGRAM_AUTH' });
    if (/FLOOD|Too many/i.test(message)) return res.status(429).json({ error: 'Telegram временно ограничил запросы. Повторите позже.', code: 'TELEGRAM_LIMIT' });
    if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED/.test(message)) return res.status(409).json({ error: 'Telegram-сессия отозвана. Обратитесь к администратору для сброса связи и подключитесь заново.', code: 'TELEGRAM_REVOKED' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Некорректный запрос', code: 'BAD_JSON' });
    // Не логируем сообщения исключений Telegram: они могут содержать приватные данные.
    console.error(JSON.stringify({ event: 'request_failed', type: error instanceof Error ? error.name : 'unknown' }));
    res.status(500).json({ error: 'Не удалось выполнить запрос. Попробуйте обновить страницу.', code: 'INTERNAL' });
  });
  return { app, store, bridge };
}
