import { moduleLessons } from './catalog-order.js';
import { setTimeout as delay } from 'node:timers/promises';
import { readCatalog } from './content.js';
import { parseStep, completionEvidence, isCompleteButton, transitionCompletes, type LearningProgress } from './progress.js';
import { TelegramClient, Api } from 'teleproto';
import QRCode from 'qrcode';
import { Raw } from 'teleproto/events/Raw.js';
import { StringSession } from 'teleproto/sessions/index.js';
import { computeCheck } from 'teleproto/Password.js';
import { Logger, LogLevel } from 'teleproto/extensions/Logger.js';
import type { Config } from './config.js';
import { Store } from './db.js';
import { AppError, digest, seal, unseal, token, safeUrl } from './security.js';
import { isRevokedTelegramSession } from './telegram-errors.js';

export interface BotButton { id?: string; text: string; url?: string; disabled?: boolean; }
export interface BotMessage { id: number; text: string; date: number; buttons: BotButton[][]; }
interface Pending { client: TelegramClient; phone: string; hash: string; expires: number; session: string; password: boolean; nextDelivery: string | null; resendAt: number; qr?: { id: string; image: string; expires: number; dirty: boolean }; }
interface Ticket { user: string; session: string; message: number; data: Buffer; fingerprint: string; expires: number; }
const expired = () => new AppError(409, 'STALE_BUTTON', 'Экран бота изменился. Обновите чат и нажмите актуальную кнопку.');
export function messageFingerprint(message: Api.Message) {
  return digest(JSON.stringify({ id: message.id, text: message.message, edit: message.editDate, markup: message.replyMarkup?.toJSON() }));
}

export class TelegramBridge {
  private clients = new Map<string, TelegramClient>();
  private pending = new Map<string, Pending>();
  private tickets = new Map<string, Ticket>();
  private busy = new Set<string>();
  private touched = new Map<string, number>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private config: Config, private store: Store, private clientFactory?: (session: string) => TelegramClient, private catalogProvider = readCatalog) {
    this.timer = setInterval(() => { void this.prune(); }, 30_000); this.timer.unref();
  }
  get configured() { return this.config.apiId > 0 && /^[a-f0-9]{32}$/i.test(this.config.apiHash); }
  private make(session = '') {
    if (!this.configured) throw new AppError(503, 'TELEGRAM_NOT_CONFIGURED', 'Администратор ещё не настроил Telegram API. Материалы уже доступны.');
    if (this.clientFactory) return this.clientFactory(session);
    return new TelegramClient(new StringSession(session), this.config.apiId, this.config.apiHash, {
      connectionRetries: 2, requestRetries: 1, floodSleepThreshold: 0, timeout: 15,
      deviceModel: 'U7 Astra', appVersion: '0.1.0', systemVersion: 'Web bridge', baseLogger: new Logger(LogLevel.NONE),
    });
  }
  async exclusive<T>(user: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(user)) throw new AppError(409, 'BUSY', 'Предыдущее действие ещё выполняется. Подождите немного.');
    this.busy.add(user);
    try { return await fn(); } finally { this.busy.delete(user); }
  }
  private async prune() {
    for (const [key, value] of this.tickets) if (value.expires < Date.now()) this.tickets.delete(key);
    for (const [key, value] of this.pending) if (!this.busy.has(key) && value.expires < Date.now()) { this.pending.delete(key); await value.client.destroy().catch(() => {}); }
    for (const [id, client] of this.clients) if (!this.busy.has(id) && (this.touched.get(id) || 0) < Date.now() - 600_000) { this.clients.delete(id); this.touched.delete(id); await client.destroy().catch(() => {}); }
  }
  async beginQr(user: string, session: string) {
    if (this.store.user(user)?.telegram) throw new AppError(409, 'ALREADY_CONNECTED', 'Сначала отключите текущий Telegram-аккаунт.');
    const previous = this.pending.get(user);
    if (previous) { this.pending.delete(user); await previous.client.destroy(); }
    const client = this.make(); client._requestRetries = 3;
    const p: Pending = { client, session, phone: '', hash: '', password: false, expires: Date.now() + 300_000, nextDelivery: null, resendAt: 0,
      qr: { id: token(), image: '', expires: 0, dirty: true } };
    client.addEventHandler(update => { if (update instanceof Api.UpdateLoginToken && p.qr) p.qr.dirty = true; }, new Raw({}));
    try {
      await client.connect(); this.pending.set(user, p);
      return await this.qrStatus(user, session, p.qr!.id);
    } catch (error) { this.pending.delete(user); await client.destroy().catch(() => {}); throw error; }
  }
  async qrStatus(user: string, session: string, attempt: string) {
    const p = this.pending.get(user);
    if (!p || p.session !== session || !p.qr || p.qr.id !== attempt || p.expires < Date.now()) throw new AppError(400, 'LOGIN_EXPIRED', 'QR-подключение истекло. Откройте подключение заново.');
    if (p.password) return { stage: 'password' };
    const qr = p.qr;
    if (qr.dirty || qr.expires <= Date.now()) {
      qr.dirty = false;
      try {
        let result = await p.client.invoke(new Api.auth.ExportLoginToken({ apiId: this.config.apiId, apiHash: this.config.apiHash, exceptIds: [] }));
        if (result instanceof Api.auth.LoginTokenMigrateTo) {
          await p.client._switchDC(result.dcId);
          result = await p.client.invoke(new Api.auth.ImportLoginToken({ token: result.token }));
        }
        if (result instanceof Api.auth.LoginTokenSuccess && result.authorization instanceof Api.auth.Authorization) return await this.complete(user, p);
        if (!(result instanceof Api.auth.LoginToken)) throw new AppError(409, 'QR_LOGIN_FAILED', 'Telegram не завершил вход по QR-коду. Начните подключение заново.');
        qr.image = await QRCode.toDataURL(`tg://login?token=${result.token.toString('base64url')}`, { width: 280, margin: 4, errorCorrectionLevel: 'M' });
        qr.expires = result.expires * 1000;
      } catch (error) {
        if (error instanceof Error && error.message.includes('SESSION_PASSWORD_NEEDED')) { p.password = true; qr.image = ''; return { stage: 'password' }; }
        qr.dirty = true; throw error;
      }
    }
    return { stage: 'qr', qrImage: qr.image, qrExpires: qr.expires, attempt: qr.id };
  }
  async begin(user: string, session: string, phone: string) {
    if (this.store.user(user)?.telegram) throw new AppError(409, 'ALREADY_CONNECTED', 'Сначала отключите текущий Telegram-аккаунт.');
    const previous = this.pending.get(user);
    if (previous) { this.pending.delete(user); await previous.client.destroy(); }
    const client = this.make();
    // При входе допускается перенос в домашний DC. Для команд боту — одна попытка.
    client._requestRetries = 3;
    try {
      await client.connect();
      const result = await client.invoke(new Api.auth.SendCode({ apiId: this.config.apiId, apiHash: this.config.apiHash, phoneNumber: phone, settings: new Api.CodeSettings({}) }));
      return this.acceptCode(user, client, session, phone, result);
    } catch (error) { await client.destroy().catch(() => {}); throw error; }
  }
  private acceptCode(user: string, client: TelegramClient, session: string, phone: string, result: Api.auth.TypeSentCode) {
    if (!(result instanceof Api.auth.SentCode)) throw new AppError(409, 'TELEGRAM_LOGIN_UNSUPPORTED', 'Telegram вернул неподдерживаемый способ входа. Отправка кода не подтверждена.');
    const delivery = result.type instanceof Api.auth.SentCodeTypeApp ? 'app' : result.type instanceof Api.auth.SentCodeTypeSms ? 'sms' : result.type instanceof Api.auth.SentCodeTypeCall ? 'call' : null;
    if (!delivery) throw new AppError(409, 'TELEGRAM_DELIVERY_UNSUPPORTED', 'Telegram выбрал способ доставки, который сайт пока не поддерживает. Не ожидайте SMS: подключение не завершено.');
    const nextDelivery = result.nextType instanceof Api.auth.CodeTypeSms ? 'sms' : result.nextType instanceof Api.auth.CodeTypeCall ? 'call' : null;
    const resendAt = Date.now() + Math.max(0, result.timeout ?? 60) * 1000;
    this.pending.set(user, { client, phone, hash: result.phoneCodeHash, expires: Math.max(Date.now() + 300_000, resendAt + 60_000), session, password: false, nextDelivery, resendAt });
    this.store.audit(user, `telegram.code.requested.${delivery}`);
    return { stage: 'code', delivery, nextDelivery, resendAt };
  }
  async resend(user: string, session: string) {
    const p = this.pending.get(user);
    if (!p || p.session !== session || p.expires < Date.now() || p.password) throw new AppError(400, 'LOGIN_EXPIRED', 'Подключение истекло. Начните вход заново.');
    if (!p.nextDelivery) throw new AppError(409, 'NO_DELIVERY_ALTERNATIVE', 'Telegram не предложил доступный для сайта следующий способ доставки.');
    if (Date.now() < p.resendAt) throw new AppError(429, 'TELEGRAM_CODE_WAIT', 'Ещё не истекло время ожидания, указанное Telegram.');
    // Не повторяем запрос автоматически: результат отправки может быть неопределённым.
    p.nextDelivery = null;
    p.client._requestRetries = 1;
    const result = await p.client.invoke(new Api.auth.ResendCode({ phoneNumber: p.phone, phoneCodeHash: p.hash }));
    try { return this.acceptCode(user, p.client, session, p.phone, result); }
    catch (error) { this.pending.delete(user); await p.client.destroy().catch(() => {}); throw error; }
  }
  async finish(user: string, session: string, code?: string, password?: string) {
    const p = this.pending.get(user);
    if (!p || p.session !== session || p.expires < Date.now()) throw new AppError(400, 'LOGIN_EXPIRED', 'Подключение истекло. Запросите новый код.');
    try {
      if (p.password) {
        if (!password) throw new AppError(400, 'PASSWORD_REQUIRED', 'Введите облачный пароль Telegram.');
        const params = await p.client.invoke(new Api.account.GetPassword());
        await p.client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(params, password) }));
      } else {
        if (p.qr) throw new AppError(400, 'QR_CONFIRM_REQUIRED', 'Сначала подтвердите QR-код в Telegram.');
        if (!code) throw new AppError(400, 'CODE_REQUIRED', 'Введите код Telegram.');
        const auth = await p.client.invoke(new Api.auth.SignIn({ phoneNumber: p.phone, phoneCodeHash: p.hash, phoneCode: code }));
        if (auth instanceof Api.auth.AuthorizationSignUpRequired) throw new AppError(400, 'EXISTING_ACCOUNT_REQUIRED', 'Нужен существующий Telegram-аккаунт.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('SESSION_PASSWORD_NEEDED')) { p.password = true; return { stage: 'password' }; }
      throw error;
    }
    return this.complete(user, p);
  }
  private async complete(user: string, p: Pending) {
    if (this.pending.get(user) !== p || p.expires < Date.now()) throw new AppError(400, 'LOGIN_EXPIRED', 'Подключение истекло.');
    const me = await p.client.getMe();
    const telegramId = me.id.toString();
    const existing = this.store.db.prepare('SELECT id FROM users WHERE telegram_id=? AND id<>?').get(telegramId, user);
    if (existing) {
      await p.client.invoke(new Api.auth.LogOut()).catch(() => {}); await p.client.destroy(); this.pending.delete(user);
      throw new AppError(409, 'ACCOUNT_LINKED', 'Этот Telegram уже подключён к другому кабинету.');
    }
    this.store.db.prepare('UPDATE users SET telegram=?,telegram_id=?,telegram_name=? WHERE id=?').run(seal(p.client.session.save() as unknown as string, this.config.key, `telegram:${user}`), telegramId, [me.firstName, me.lastName].filter(Boolean).join(' '), user);
    p.client._requestRetries = 1;
    this.pending.delete(user); this.clients.set(user, p.client); this.touched.set(user, Date.now()); this.store.audit(user, 'telegram.connected');
    return { stage: 'connected' };
  }
  private async client(user: string) {
    this.touched.set(user, Date.now());
    const row = this.store.user(user);
    if (!row?.telegram) throw new AppError(409, 'NOT_CONNECTED', 'Сначала подключите Telegram в личном кабинете.');
    let client = this.clients.get(user);
    if (!client) {
      client = this.make(unseal(row.telegram, this.config.key, `telegram:${user}`));
      try { await client.connect(); } catch (error) { await client.destroy().catch(() => {}); throw error; }
      this.clients.set(user, client);
    }
    return client;
  }
  private async peer(client: TelegramClient) {
    const entity = await client.getEntity(this.config.bot);
    if (!(entity instanceof Api.User) || !entity.bot) throw new AppError(409, 'BOT_INVALID', 'Настроенный адрес не принадлежит боту.');
    const actual = entity.id.toString();
    const pinned = this.config.botId || this.store.db.prepare("SELECT value FROM settings WHERE key='bot_id'").get()?.value;
    if (pinned && actual !== pinned) throw new AppError(409, 'BOT_CHANGED', 'Идентификатор бота изменился. Действия остановлены до проверки администратором.');
    if (!pinned) this.store.db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('bot_id',?)").run(actual);
    return entity;
  }
  private async replaceClient(user: string) {
    const previous = this.clients.get(user);
    this.clients.delete(user);
    if (previous) await previous.destroy().catch(() => {});
    return this.client(user);
  }
  private async readMessages(user: string, session: string) {
    const client = await this.client(user), peer = await this.peer(client);
    const messages = await client.getMessages(peer, { limit: 35 });
    for (const [id, ticket] of this.tickets) if (ticket.user === user && ticket.session === session) this.tickets.delete(id);
    return messages.filter((m): m is Api.Message => m instanceof Api.Message && !m.out).slice(0, 15).map(m => {
      const fingerprint = messageFingerprint(m);
      const rows = m.replyMarkup instanceof Api.ReplyInlineMarkup ? m.replyMarkup.rows : [];
      const buttons = rows.map(row => row.buttons.map(button => {
        if (button.type instanceof Api.InlineButtonTypeCallback && !button.type.requiresPassword) {
          const id = token();
          this.tickets.set(id, { user, session, message: m.id, data: Buffer.from(button.type.data), fingerprint, expires: Date.now() + 90_000 });
          return { id, text: button.text };
        }
        if (button.type instanceof Api.InlineButtonTypeUrl) { const url = safeUrl(button.type.url); if (url) return { text: button.text, url }; }
        return { text: button.text, disabled: true };
      }));
      return { id: m.id, text: m.message, date: m.editDate || m.date, buttons };
    });
  }
  async messages(user: string, session: string) {
    try { return await this.readMessages(user, session); }
    catch (error) {
      // A cached MTProto client can lose its socket after a local network sleep.
      // Reading the chat is idempotent, so reconnect once instead of showing a false disconnect.
      if (error instanceof AppError || isRevokedTelegramSession(error)) throw error;
      await this.replaceClient(user);
      return this.readMessages(user, session);
    }
  }
  async learning(user: string, session: string, backfill = true): Promise<LearningProgress> {
    const catalog = this.catalogProvider(), row = this.store.user(user)!;
    const messages = await this.messages(user, session);
    const telegramId = row.telegram_id!;
    this.store.db.prepare('INSERT OR IGNORE INTO learning_history(user_id,telegram_id) VALUES(?,?)').run(user, telegramId);
    const history = this.store.db.prepare('SELECT cursor,exhausted,revision,head FROM learning_history WHERE user_id=? AND telegram_id=?').get(user, telegramId)!;
    // Reparse old messages after curriculum changes or a gap while the website was offline.
    // A position in the course alone is never evidence of completion.
    const oldest = messages.length ? Math.min(...messages.map(m => m.id)) : 0;
    if (backfill && (history.revision !== catalog.revision || (Number(history.head) > 0 && oldest > Number(history.head)))) {
      this.store.db.prepare('UPDATE learning_history SET cursor=0,exhausted=0,revision=? WHERE user_id=? AND telegram_id=?').run(catalog.revision, user, telegramId);
      history.cursor = 0; history.exhausted = 0;
    }
    const evidenceMessages = [...messages];
    if (backfill && !history.exhausted) {
      const client = await this.client(user), peer = await this.peer(client);
      const batch = await client.getMessages(peer, { limit: 100, offsetId: Number(history.cursor) || 0 });
      evidenceMessages.push(...batch.filter((m): m is Api.Message => m instanceof Api.Message && !m.out).map(m => ({ id: m.id, text: m.message, date: m.date, buttons: [] })));
      const cursor = batch.length ? Math.min(...batch.map(m => m.id)) + 1 : Number(history.cursor);
      this.store.db.prepare('UPDATE learning_history SET cursor=?,exhausted=? WHERE user_id=? AND telegram_id=?').run(cursor, batch.length < 100 ? 1 : 0, user, telegramId);
    }
    const save = this.store.db.prepare('INSERT OR IGNORE INTO learning_steps VALUES(?,?,?,?)');
    for (const [step, evidence] of completionEvidence(evidenceMessages, catalog)) save.run(user, telegramId, step, evidence);
    if (backfill && messages.length) this.store.db.prepare('UPDATE learning_history SET head=? WHERE user_id=? AND telegram_id=?').run(Math.max(...messages.map(m => m.id)), user, telegramId);
    const completedStepIds = this.store.db.prepare('SELECT step_id FROM learning_steps WHERE user_id=? AND telegram_id=?').all(user, telegramId).map(r => String(r.step_id));
    const done = new Set(completedStepIds);
    const completedLessonIds = catalog.lessons.filter(l => l.stepIds.length && l.stepIds.every(id => done.has(id))).map(l => l.id);
    const lessons = new Set(completedLessonIds);
    const screen = messages.find(m => parseStep(m, catalog));
    const parsed = screen ? parseStep(screen, catalog) : null;
    const button = screen?.buttons.flat().find(b => b.id && isCompleteButton(b.text));
    const current = parsed && !done.has(parsed.stepId) ? { lessonId: parsed.lesson.id, stepId: parsed.stepId, title: catalog.steps.find(s => s.id === parsed.stepId)!.title, stream: parsed.stream, ticket: button?.id } : null;
    const historyComplete = !!this.store.db.prepare('SELECT exhausted FROM learning_history WHERE user_id=? AND telegram_id=?').get(user, telegramId)?.exhausted;
    return { completedStepIds, completedLessonIds, current, historyComplete, syncedAt: Date.now(),
      modules: catalog.modules.map(m => { const active = moduleLessons(catalog, m).active; return { id: m.id, completed: active.filter(l => lessons.has(l.id)).length, total: active.length }; }),
      notice: !historyComplete ? 'Восстанавливаем завершённые шаги из истории бота…' : 'Галочки подтверждены доступной историей бота. Удалённые сообщения и отличия программы могут оставить часть прогресса неизвестной.' };
  }
  async completeLearningStep(user: string, session: string, stepId: string) {
    const before = await this.learning(user, session, false);
    if (!before.current || before.current.stepId !== stepId || !before.current.ticket) throw expired();
    const catalog = this.catalogProvider();
    const original = (await this.messages(user, session)).find(m => parseStep(m, catalog)?.stepId === stepId && m.buttons.flat().some(b => b.id && isCompleteButton(b.text)));
    const parsed = original && parseStep(original, catalog);
    const ticket = original?.buttons.flat().find(b => b.id && isCompleteButton(b.text))?.id;
    if (!original || !parsed || !ticket) throw expired();
    await this.click(user, session, ticket);
    let advanced = false;
    for (let i = 0; i < 5; i++) {
      await delay(700);
      const messages = await this.messages(user, session);
      const transition = messages.find(m => m.id >= original.id && transitionCompletes(m.text, parsed));
      if (transition) {
        const row = this.store.user(user)!;
        const save = this.store.db.prepare('INSERT OR IGNORE INTO learning_steps VALUES(?,?,?,?)');
        for (const id of parsed.lesson.stepIds) save.run(user, row.telegram_id!, id, transition.id);
        const next = transition.buttons.flat().find(b => b.id && /^▶️?\s*Начать следующий (урок|проект)$/.test(b.text));
        if (next?.id && !advanced) { advanced = true; await this.click(user, session, next.id); continue; }
      }
      const state = await this.learning(user, session, false);
      if (state.completedStepIds.includes(stepId) && (state.current || !transition?.buttons.flat().some(b => b.id && /Начать следующий/.test(b.text)))) return state;
    }
    return this.learning(user, session, false);
  }
  async click(user: string, session: string, ticketId: string) {
    const ticket = this.tickets.get(ticketId);
    if (!ticket || ticket.user !== user || ticket.session !== session || ticket.expires < Date.now()) throw expired();
    this.tickets.delete(ticketId);
    const client = await this.client(user), peer = await this.peer(client);
    const [message] = await client.getMessages(peer, { ids: [ticket.message] });
    if (!(message instanceof Api.Message) || message.out || messageFingerprint(message) !== ticket.fingerprint) throw expired();
    const buttons = message.replyMarkup instanceof Api.ReplyInlineMarkup ? message.replyMarkup.rows.flatMap(r => r.buttons) : [];
    if (!buttons.some(b => b.type instanceof Api.InlineButtonTypeCallback && !b.type.requiresPassword && b.type.data.equals(ticket.data))) throw expired();
    const action = digest(`${ticket.message}:${ticket.fingerprint}:${ticket.data.toString('base64')}`);
    const prior = this.store.db.prepare('SELECT status,created FROM actions WHERE user_id=? AND fingerprint=?').get(user, action);
    if (prior && (prior.status === 'uncertain' || Date.now() - Number(prior.created) < 15_000)) throw new AppError(409, 'ALREADY_SENT', 'Эта команда уже отправлена. Проверьте ответ бота; автоматический повтор отключён.');
    this.store.db.prepare("INSERT INTO actions VALUES(?,?,'uncertain',?) ON CONFLICT(user_id,fingerprint) DO UPDATE SET status='uncertain',created=excluded.created").run(user, action, Date.now());
    try {
      const result = await client.invoke(new Api.messages.GetBotCallbackAnswer({ peer, msgId: ticket.message, data: ticket.data }));
      this.store.db.prepare("UPDATE actions SET status='acknowledged' WHERE user_id=? AND fingerprint=?").run(user, action);
      this.store.audit(user, 'telegram.button.sent');
      return { message: result.message || 'Нажатие передано боту. Результат появится в его ответе.', acknowledged: true };
    } catch {
      this.store.audit(user, 'telegram.button.uncertain');
      throw new AppError(409, 'RESULT_UNKNOWN', 'Бот мог выполнить действие, но подтверждение не получено. Обновите чат. Не повторяйте действие вслепую.');
    }
  }
  async send(user: string, text: string) {
    const client = await this.client(user), peer = await this.peer(client);
    await client.sendMessage(peer, { message: text, parseMode: false, linkPreview: false });
    this.store.audit(user, 'telegram.message.sent');
    return { message: 'Сообщение отправлено боту.' };
  }
  async cancel(user: string, session: string) {
    const pending = this.pending.get(user);
    if (pending?.session === session) { this.pending.delete(user); await pending.client.destroy(); }
    for (const [id, ticket] of this.tickets) if (ticket.user === user && ticket.session === session) this.tickets.delete(id);
  }
  async disconnect(user: string) {
    let client = this.clients.get(user);
    // Сначала отзываем авторизацию в Telegram. При сбое оставляем возможность повторить отзыв.
    try { client ??= await this.client(user); await client.invoke(new Api.auth.LogOut()); }
    catch (error) { if (!isRevokedTelegramSession(error)) throw error; }
    if (client) await client.destroy().catch(() => {});
    this.clients.delete(user); this.touched.delete(user);
    this.store.db.prepare('UPDATE users SET telegram=NULL,telegram_id=NULL,telegram_name=NULL WHERE id=?').run(user);
    for (const [id, ticket] of this.tickets) if (ticket.user === user) this.tickets.delete(id);
    this.store.audit(user, 'telegram.revoked');
  }
  async close() { clearInterval(this.timer); await Promise.allSettled([...this.clients.values(), ...[...this.pending.values()].map(p => p.client)].map(c => c.destroy())); }
}
