import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import bigInt from 'big-integer';
import { Api, type TelegramClient } from 'teleproto';
import { TelegramBridge } from '../server/telegram.js';
import { Store } from '../server/db.js';
import { seal } from '../server/security.js';
import type { Config } from '../server/config.js';
test('Вход сообщает способ доставки, скрывает хеш и отклоняет неподдерживаемый ответ', async () => {
  const store = new Store(':memory:');
  store.db.prepare('INSERT INTO users(id,email,name,password,created) VALUES(?,?,?,?,?)').run('login-user', 'login@example.test', 'Login', 'unused', Date.now());
  const config: Config = { key: randomBytes(32), production: false, origin: 'http://localhost:4173', host: '127.0.0.1', port: 4173, dbPath: ':memory:', apiId: 12345, apiHash: 'a'.repeat(32), bot: 'u7_school_bot', botId: '100' };
  let delivery: Api.auth.TypeSentCodeType = new Api.auth.SentCodeTypeApp({ length: 5 });
  let destroyed = 0, resends = 0, timeout = 60;
  let nextType: Api.auth.TypeCodeType | undefined = new Api.auth.CodeTypeSms();
  const fake = { connect: async () => {}, destroy: async () => { destroyed++; }, invoke: async (request: unknown) => {
    assert(request instanceof Api.auth.SendCode || request instanceof Api.auth.ResendCode);
    if (request instanceof Api.auth.ResendCode) { assert.equal(request.phoneCodeHash, 'private-hash'); resends++; }
    return new Api.auth.SentCode({ type: delivery, phoneCodeHash: 'private-hash', nextType, timeout });
  } } as unknown as TelegramClient;
  const bridge = new TelegramBridge(config, store, () => fake);
  try {
    assert.equal((await bridge.begin('login-user', 'browser', '+12025550123')).delivery, 'app');
    await assert.rejects(() => bridge.resend('login-user', 'other-browser'), { code: 'LOGIN_EXPIRED' });
    await assert.rejects(() => bridge.resend('login-user', 'browser'), { code: 'TELEGRAM_CODE_WAIT' });
    assert.equal(resends, 0);
    timeout = 0;
    await bridge.begin('login-user', 'browser', '+12025550123');
    nextType = undefined;
    delivery = new Api.auth.SentCodeTypeSms({ length: 5 });
    assert.equal((await bridge.resend('login-user', 'browser')).delivery, 'sms');
    assert.equal(resends, 1);
    await assert.rejects(() => bridge.resend('login-user', 'browser'), { code: 'NO_DELIVERY_ALTERNATIVE' });
    assert.equal(resends, 1);
    assert.equal((await bridge.begin('login-user', 'browser', '+12025550123')).delivery, 'sms');
    delivery = new Api.auth.SentCodeTypeSetUpEmailRequired({});
    await assert.rejects(() => bridge.begin('login-user', 'browser', '+12025550123'), { code: 'TELEGRAM_DELIVERY_UNSUPPORTED' });
    await assert.rejects(() => bridge.finish('login-user', 'browser', '12345'), { code: 'LOGIN_EXPIRED' });
    assert.equal(destroyed, 4);
  } finally { await bridge.close(); store.close(); }
});
test('Revoked or duplicated session is not retried; disconnect clears only its owner and preserves learning history', async () => {
  for (const phase of ['connect', 'logout'] as const) {
    for (const rpc of ['AUTH_KEY_DUPLICATED', 'AUTH_KEY_UNREGISTERED', 'SESSION_REVOKED']) {
      const key = randomBytes(32), store = new Store(':memory:');
      for (const id of ['alice', 'bob']) store.db.prepare('INSERT INTO users(id,email,name,password,telegram,telegram_id,created) VALUES(?,?,?,?,?,?,?)').run(id, `${id}@example.test`, id, 'unused', seal('fake-session', key, `telegram:${id}`), id, Date.now());
      store.db.prepare('INSERT INTO learning_steps VALUES(?,?,?,?)').run('alice', 'alice', 'completed-step', 1);
      const config: Config = { key, production: false, origin: 'http://localhost:4173', host: '127.0.0.1', port: 4173, dbPath: ':memory:', apiId: 12345, apiHash: 'a'.repeat(32), bot: 'u7_school_bot', botId: '100' };
      let connections = 0, destroyed = 0;
      const error = Object.assign(new Error('Authorization invalidated'), { errorMessage: rpc });
      const fake = { connect: async () => { connections++; if (phase === 'connect') throw error; }, destroy: async () => { destroyed++; }, getEntity: async () => new Api.User({ id: bigInt(100), bot: true }), getMessages: async () => { throw error; }, invoke: async () => { throw error; } } as unknown as TelegramClient;
      const bridge = new TelegramBridge(config, store, () => fake);
      try {
        await assert.rejects(() => bridge.messages('alice', 'browser'), error);
        assert.equal(connections, 1);
        assert(store.user('alice')!.telegram);
        await bridge.disconnect('alice');
        assert.equal(store.user('alice')!.telegram, null);
        assert(store.user('bob')!.telegram);
        assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM learning_steps WHERE user_id=?').get('alice')!.n, 1);
        assert.equal(destroyed, phase === 'connect' ? 2 : 1);
      } finally { await bridge.close(); store.close(); }
    }
  }
});

test('Temporary network failure does not erase a saved Telegram session during disconnect', async () => {
  const key = randomBytes(32), store = new Store(':memory:');
  store.db.prepare('INSERT INTO users(id,email,name,password,telegram,created) VALUES(?,?,?,?,?,?)').run('alice', 'alice@example.test', 'Alice', 'unused', seal('fake-session', key, 'telegram:alice'), Date.now());
  const config: Config = { key, production: false, origin: 'http://localhost:4173', host: '127.0.0.1', port: 4173, dbPath: ':memory:', apiId: 12345, apiHash: 'a'.repeat(32), bot: 'u7_school_bot', botId: '100' };
  const fake = { connect: async () => { throw new Error('ETIMEDOUT'); }, destroy: async () => {} } as unknown as TelegramClient;
  const bridge = new TelegramBridge(config, store, () => fake);
  try { await assert.rejects(() => bridge.disconnect('alice'), /ETIMEDOUT/); assert(store.user('alice')!.telegram); }
  finally { await bridge.close(); store.close(); }
});

function fixture() {
  const key = randomBytes(32), store = new Store(':memory:');
  for (const id of ['alice', 'bob']) store.db.prepare('INSERT INTO users(id,email,name,password,telegram,created) VALUES(?,?,?,?,?,?)').run(id, `${id}@example.test`, id, 'unused', seal('fake-session', key, `telegram:${id}`), Date.now());
  const config: Config = { key, production: false, origin: 'http://localhost:4173', host: '127.0.0.1', port: 4173, dbPath: ':memory:', apiId: 12345, apiHash: 'a'.repeat(32), bot: 'u7_school_bot', botId: '100' };
  const peer = new Api.User({ id: bigInt(100), bot: true, firstName: 'School' });
  const data = Buffer.from('complete:opaque:~1');
  let message = new Api.Message({ id: 7, date: 100, message: 'Текущий шаг', peerId: new Api.PeerUser({ userId: peer.id }), replyMarkup: new Api.ReplyInlineMarkup({ rows: [new Api.KeyboardInlineButtonRow({ buttons: [new Api.KeyboardInlineButton({ text: '✅ Выполнено', type: new Api.InlineButtonTypeCallback({ data }) })] })] }) });
  let calls = 0, fail = false; const targets: string[] = [];
  const fake = { connect: async () => {}, destroy: async () => {}, getEntity: async (name: string) => { targets.push(name); return peer; }, getMessages: async () => [message], invoke: async (request: unknown) => { assert(request instanceof Api.messages.GetBotCallbackAnswer); assert.deepEqual(request.data, data); calls++; if (fail) throw new Error('timeout'); return { message: '' }; } } as unknown as TelegramClient;
  const bridge = new TelegramBridge(config, store, () => fake);
  return { store, bridge, targets, calls: () => calls, fail: () => { fail = true; }, edit: () => { message = new Api.Message({ ...message, message: 'Другой шаг', editDate: 200 }); }, cleanup: async () => { await bridge.close(); store.close(); } };
}
test('Кнопка связана с пользователем и браузерной сессией; на клиент не выдаётся callback_data', async () => {
  const f = fixture(); try {
    const messages = await f.bridge.messages('alice', 'session-a'); const ticket = messages[0].buttons[0][0].id!;
    assert(!JSON.stringify(messages).includes('complete:opaque'));
    await assert.rejects(() => f.bridge.click('bob', 'session-b', ticket));
    await assert.rejects(() => f.bridge.click('alice', 'wrong-session', ticket));
    await f.bridge.click('alice', 'session-a', ticket); assert.equal(f.calls(), 1);
    await assert.rejects(() => f.bridge.click('alice', 'session-a', ticket)); assert.equal(f.calls(), 1);
    assert(f.targets.every(t => t === 'u7_school_bot'));
  } finally { await f.cleanup(); }
});
test('Изменённое сообщение нельзя нажать по старому разрешению', async () => {
  const f = fixture(); try {
    const ticket = (await f.bridge.messages('alice', 'session-a'))[0].buttons[0][0].id!;
    f.edit(); await assert.rejects(() => f.bridge.click('alice', 'session-a', ticket)); assert.equal(f.calls(), 0);
  } finally { await f.cleanup(); }
});
test('После неопределённого результата повтор заблокирован даже с новым разрешением', async () => {
  const f = fixture(); try {
    f.fail(); const ticket = (await f.bridge.messages('alice', 'session-a'))[0].buttons[0][0].id!;
    await assert.rejects(() => f.bridge.click('alice', 'session-a', ticket)); assert.equal(f.calls(), 1);
    const next = (await f.bridge.messages('alice', 'session-a'))[0].buttons[0][0].id!;
    await assert.rejects(() => f.bridge.click('alice', 'session-a', next)); assert.equal(f.calls(), 1);
  } finally { await f.cleanup(); }
});
test('Одновременные действия одного ученика не выполняются параллельно', async () => {
  const f = fixture(); try {
    let release!: () => void; const first = f.bridge.exclusive('alice', () => new Promise<void>(resolve => { release = resolve; }));
    await assert.rejects(() => f.bridge.exclusive('alice', async () => {}));
    await f.bridge.exclusive('bob', async () => {}); release(); await first;
  } finally { await f.cleanup(); }
});

function qrFixture() {
  const store = new Store(':memory:'), key = randomBytes(32);
  for (const id of ['alice', 'bob']) store.db.prepare('INSERT INTO users(id,email,name,password,created) VALUES(?,?,?,?,?)').run(id, `${id}@example.test`, id, 'unused', Date.now());
  const config: Config = { key, production: false, origin: 'http://localhost:4173', host: '127.0.0.1', port: 4173, dbPath: ':memory:', apiId: 12345, apiHash: 'a'.repeat(32), bot: 'u7_school_bot', botId: '100' };
  let update: (event: unknown) => void = () => {}, calls = 0, destroyed = 0, switched = 0;
  const me = new Api.User({ id: bigInt(123), firstName: 'Student' });
  let response: Api.auth.TypeLoginToken | Error = new Api.auth.LoginToken({ token: Buffer.from('test-only-qr-token'), expires: Math.floor(Date.now() / 1000) + 30 });
  const success = new Api.auth.LoginTokenSuccess({ authorization: new Api.auth.Authorization({ user: me }) });
  const fake = {
    connect: async () => {}, destroy: async () => { destroyed++; },
    addEventHandler: (handler: typeof update) => { update = handler; },
    _switchDC: async (dc: number) => { switched = dc; },
    session: { save: () => 'secret-session' }, getMe: async () => me,
    invoke: async (request: unknown) => {
      calls++;
      if (request instanceof Api.auth.ImportLoginToken) { assert.equal(switched, 4); return success; }
      if (request instanceof Api.auth.LogOut) return {};
      assert(request instanceof Api.auth.ExportLoginToken);
      if (response instanceof Error) throw response;
      return response;
    },
  } as unknown as TelegramClient;
  const bridge = new TelegramBridge(config, store, () => fake);
  return { bridge, store, key, success, calls: () => calls, destroyed: () => destroyed, switched: () => switched,
    reply: (value: typeof response) => { response = value; update(new Api.UpdateLoginToken()); },
    close: async () => { await bridge.close(); store.close(); } };
}

test('QR привязан к кабинету, браузеру и попытке; ожидание не создаёт лишних токенов', async () => {
  const f = qrFixture();
  try {
    const qr = await f.bridge.beginQr('alice', 'browser-a');
    assert.equal(qr.stage, 'qr'); assert('attempt' in qr); assert(qr.attempt!); assert('qrImage' in qr); assert(qr.qrImage);
    assert.match(qr.qrImage, /^data:image\/png;base64,/);
    await assert.rejects(() => f.bridge.qrStatus('bob', 'browser-a', qr.attempt!), { code: 'LOGIN_EXPIRED' });
    await assert.rejects(() => f.bridge.qrStatus('alice', 'browser-b', qr.attempt!), { code: 'LOGIN_EXPIRED' });
    await assert.rejects(() => f.bridge.qrStatus('alice', 'browser-a', 'wrong-attempt'), { code: 'LOGIN_EXPIRED' });
    await f.bridge.qrStatus('alice', 'browser-a', qr.attempt!); assert.equal(f.calls(), 1);
    await assert.rejects(() => f.bridge.finish('alice', 'browser-a', '12345'), { code: 'QR_CONFIRM_REQUIRED' });
    await f.bridge.cancel('alice', 'browser-b'); assert.equal(f.destroyed(), 0);
    await f.bridge.cancel('alice', 'browser-a'); assert.equal(f.destroyed(), 1);
    await assert.rejects(() => f.bridge.qrStatus('alice', 'browser-a', qr.attempt!), { code: 'LOGIN_EXPIRED' });
  } finally { await f.close(); }
});

test('QR обрабатывает перенос DC и сохраняет зашифрованную сессию после подтверждения', async () => {
  const f = qrFixture();
  try {
    const qr = await f.bridge.beginQr('alice', 'browser-a'); assert('attempt' in qr); assert(qr.attempt!);
    assert.equal(f.store.user('alice')!.telegram, null);
    f.reply(new Api.auth.LoginTokenMigrateTo({ dcId: 4, token: Buffer.from('migration') }));
    assert.equal((await f.bridge.qrStatus('alice', 'browser-a', qr.attempt!)).stage, 'connected');
    assert.equal(f.switched(), 4);
    const encrypted = f.store.user('alice')!.telegram!;
    assert(encrypted); assert(!encrypted.includes('secret-session'));
    assert.equal(f.store.user('bob')!.telegram, null);
    await assert.rejects(() => f.bridge.qrStatus('alice', 'browser-a', qr.attempt!), { code: 'LOGIN_EXPIRED' });
  } finally { await f.close(); }
});

test('QR сохраняет требование облачного пароля и не авторизует преждевременно', async () => {
  const f = qrFixture();
  try {
    const qr = await f.bridge.beginQr('alice', 'browser-a'); assert('attempt' in qr); assert(qr.attempt!);
    f.reply(new Error('SESSION_PASSWORD_NEEDED'));
    assert.equal((await f.bridge.qrStatus('alice', 'browser-a', qr.attempt!)).stage, 'password');
    assert.equal(f.store.user('alice')!.telegram, null);
    await assert.rejects(() => f.bridge.finish('alice', 'browser-a'), { code: 'PASSWORD_REQUIRED' });
  } finally { await f.close(); }
});

test('QR обновляет истёкшее изображение и прекращает попытку после пяти минут', async () => {
  const f = qrFixture(), realNow = Date.now;
  try {
    const qr = await f.bridge.beginQr('alice', 'browser-a'); assert('attempt' in qr); assert(qr.attempt!);
    const now = realNow(); Date.now = () => now + 31_000;
    await f.bridge.qrStatus('alice', 'browser-a', qr.attempt!); assert.equal(f.calls(), 2);
    Date.now = () => now + 301_000;
    await assert.rejects(() => f.bridge.qrStatus('alice', 'browser-a', qr.attempt!), { code: 'LOGIN_EXPIRED' });
    assert.equal(f.store.user('alice')!.telegram, null);
  } finally { Date.now = realNow; await f.close(); }
});
