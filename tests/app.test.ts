import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { createApp } from '../server/app.js';
import { Store } from '../server/db.js';
import { token, digest, seal } from '../server/security.js';
import type { Config } from '../server/config.js';
import { SESSION_TTL_MS } from '../server/session-policy.js';
const origin = 'http://127.0.0.1:4173';
const config: Config = { production: false, origin, host: '127.0.0.1', port: 4173, key: randomBytes(32), dbPath: ':memory:', apiId: 0, apiHash: '', bot: 'u7_school_bot', botId: '' };
function fixture() {
  const store = new Store(':memory:'); const value = createApp(config, store);
  const client = request.agent(value.app);
  const post = (url: string) => client.post(url).set('Host', '127.0.0.1:4173').set('Origin', origin).set('X-U7-Request', '1');
  const get = (url: string) => client.get(url).set('Host', '127.0.0.1:4173');
  return { ...value, client, post, get, cleanup: async () => { await value.bridge.close(); store.close(); } };
}
test('Закрытые API, проверка Host, Origin и JSON', async () => {
  const f = fixture(); try {
    assert.equal((await f.get('/api/me')).status, 401);
    assert.equal((await request(f.app).get('/api/public').set('Host', 'attacker.example')).status, 403);
    assert.equal((await f.post('/api/auth/register').set('Origin', 'https://attacker.example').send({})).status, 403);
    assert.equal((await f.post('/api/auth/register').type('form').send('a=1')).status, 403);
    const response = await f.get('/api/public'); assert.equal(response.status, 200); assert.equal(response.headers['cache-control'], 'no-store');
    assert(response.body.catalog.steps.every((step: { content: string; code: string }) => !step.content && !step.code));
    assert(response.headers['content-security-policy'].includes("frame-ancestors 'none'")); assert(!JSON.stringify(response.body).includes('MASTER_KEY'));
  } finally { await f.cleanup(); }
});
test('Регистрация открыта; CSRF обязателен; сеанс отзывается; токен хранится хешем', async () => {
  const f = fixture(); try {
    const body = { email: 'alice@example.test', name: 'Алиса', password: 'Long-password-test-1' };
    const registration = await f.post('/api/auth/register').send(body); assert.equal(registration.status, 200);
    assert((await f.get('/api/public')).body.catalog.steps.every((step: { content: string; code: string }) => !step.content && !step.code));
    assert.equal((await f.get('/api/learning')).status, 409);
    const csrf = registration.body.csrf, user = registration.body.user;
    const cookie = registration.headers['set-cookie'][0]; assert(cookie.includes('HttpOnly')); assert(cookie.includes('SameSite=Strict'));
    const raw = cookie.split(';')[0].split('=')[1]; assert.equal(f.store.db.prepare('SELECT hash FROM sessions').get()?.hash, digest(raw));
    assert.equal((await f.post('/api/auth/register').send(body)).status, 400);
    assert.equal((await f.post('/api/auth/logout').send({})).status, 403);
    assert.equal((await f.client.patch('/api/profile').set('Host', '127.0.0.1:4173').set('Origin', origin).set('X-U7-Request', '1').set('X-CSRF-Token', csrf).send({ name: 'Новое имя', id: 'other-user' })).status, 400);
    assert.equal((await f.post('/api/telegram/message').set('X-CSRF-Token', csrf).send({ text: '/start' })).status, 409);
    assert(!JSON.stringify((await f.get('/api/me')).body).includes('password'));
    assert.equal((await f.post('/api/auth/logout').set('X-CSRF-Token', csrf).send({})).status, 200);
    assert.equal((await f.get('/api/me')).status, 401); assert.equal(f.store.user(user.id)?.name, 'Алиса');
  } finally { await f.cleanup(); }
});
test('Вход только с паролем работает и для кабинета со старой записью TOTP', async () => {
  const f = fixture(); try {
    const body = { email: 'legacy@example.test', name: 'Ученик', password: 'Long-password-test-2' };
    const response = await f.post('/api/auth/register').send(body); const id = response.body.user.id;
    f.store.db.prepare('UPDATE users SET totp=? WHERE id=?').run(seal('legacy-secret', config.key, `totp:${id}`), id);
    const login = await f.post('/api/auth/login').send({ email: body.email, password: body.password });
    assert.equal(login.status, 200); assert.equal(login.body.user.id, id);
    assert.equal((await f.post('/api/security/mfa/start').set('X-CSRF-Token', login.body.csrf).send({ password: body.password })).status, 404);
  } finally { await f.cleanup(); }
});
test('Два ученика видят только свои данные и журнал; чужой CSRF не работает', async () => {
  const f = fixture(); try {
    const a = await f.post('/api/auth/register').send({ email: 'a@example.test', name: 'Алиса', password: 'Long-password-test-A' });
    const cookieA = a.headers['set-cookie'][0].split(';')[0]; f.store.audit(a.body.user.id, 'only-alice');
    const b = await f.post('/api/auth/register').send({ email: 'b@example.test', name: 'Борис', password: 'Long-password-test-B' });
    const securityB = await f.get('/api/security'); assert(!JSON.stringify(securityB.body).includes('only-alice'));
    assert.equal((await f.post('/api/auth/logout').set('X-CSRF-Token', a.body.csrf).send({})).status, 403);
    const alice = await request(f.app).get('/api/me').set('Host', '127.0.0.1:4173').set('Cookie', cookieA); assert.equal(alice.body.user.name, 'Алиса');
    assert.notEqual(a.body.user.id, b.body.user.id);
  } finally { await f.cleanup(); }
});
test('Истёкшая сессия не принимается', async () => {
  const f = fixture(); try {
    const body = { email: 'expired@example.test', name: 'Ученик', password: 'Long-password-test-3' };
    assert.equal((await f.post('/api/auth/register').send(body)).status, 200);
    f.store.db.prepare('UPDATE sessions SET expires=0').run(); assert.equal((await f.get('/api/me')).status, 401);
  } finally { await f.cleanup(); }
});

test('Сохранённый cookie работает спустя 29 дней и продлевает БД и браузер ещё на месяц', async () => {
  const f = fixture(); try {
    const registration = await f.post('/api/auth/register').send({ email: 'rolling@example.test', name: 'Ученик', password: 'Long-password-test-4' });
    const cookie = registration.headers['set-cookie'][0];
    assert.match(cookie, /Max-Age=2592000/); assert.match(cookie, /Expires=/);
    const originalCookie = cookie.split(';')[0], old = Date.now() - 29 * 86400_000;
    f.store.db.prepare('UPDATE sessions SET created=?,touched=?,expires=?').run(old, old, Date.now() + 86400_000);
    const before = Date.now();
    // Новый HTTP-клиент с сохранённым cookie имитирует повторное открытие браузера.
    const restored = await request(f.app).get('/api/me').set('Host', '127.0.0.1:4173').set('Cookie', originalCookie);
    assert.equal(restored.status, 200); assert.match(restored.headers['set-cookie'][0], /Max-Age=2592000/);
    assert.equal(restored.headers['set-cookie'][0].split(';')[0], originalCookie);
    const row = f.store.db.prepare('SELECT * FROM sessions').get()!;
    assert(Number(row.expires) >= before + SESSION_TTL_MS); assert(Number(row.touched) >= before);
    assert.equal(Number(row.created), old);
  } finally { await f.cleanup(); }
});

test('Истечение 30 дней и отозванная сессия не продлеваются; чужой CSRF также не продлевает вход', async () => {
  const f = fixture(); try {
    const registration = await f.post('/api/auth/register').send({ email: 'expiry@example.test', name: 'Ученик', password: 'Long-password-test-5' });
    const expires = Date.now() + 10000;
    f.store.db.prepare('UPDATE sessions SET expires=?').run(expires);
    assert.equal((await f.post('/api/auth/logout').set('X-CSRF-Token', 'wrong').send({})).status, 403);
    assert.equal(f.store.db.prepare('SELECT expires FROM sessions').get()?.expires, expires);
    f.store.db.prepare('UPDATE sessions SET expires=?').run(Date.now() - 1);
    const expired = await f.get('/api/me'); assert.equal(expired.status, 401); assert(!expired.headers['set-cookie']);
    f.store.db.prepare('DELETE FROM sessions').run();
    const revoked = await f.get('/api/me'); assert.equal(revoked.status, 401); assert(!revoked.headers['set-cookie']);
    assert(registration.body.csrf);
  } finally { await f.cleanup(); }
});
