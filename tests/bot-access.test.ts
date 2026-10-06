import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Api, type TelegramClient } from 'teleproto';
import bigInt from 'big-integer';
import { Store } from '../server/db.js';
import { TelegramBridge } from '../server/telegram.js';
import { seal } from '../server/security.js';
import { effectiveRole, setUserRole } from '../server/roles.js';
import type { Config } from '../server/config.js';

test('Bot screens grant and revoke student status; old screens and completion marks never override newer denial; mentor survives', async () => {
  const store = new Store(':memory:'), key = randomBytes(32);
  for (const id of ['alice', 'bob']) store.db.prepare('INSERT INTO users(id,email,name,password,telegram,telegram_id,created) VALUES(?,?,?,?,?,?,?)').run(id, `${id}@example.test`, id, 'unused', seal('fake', key, `telegram:${id}`), id, 1);
  const peer = new Api.User({ id: bigInt(100), bot: true });
  const message = (id: number, date: number, text: string, callback?: string, out = false) => new Api.Message({ id, date, message: text, out, peerId: new Api.PeerUser({ userId: peer.id }), replyMarkup: callback ? new Api.ReplyInlineMarkup({ rows: [new Api.KeyboardInlineButtonRow({ buttons: [new Api.KeyboardInlineButton({ text: 'Уроки', type: new Api.InlineButtonTypeCallback({ data: Buffer.from(callback) }) })] })] }) : undefined });
  let list = [message(1, 100, '📖 Моя учёба', 'nav-tree:my-study:lessons')];
  const fake = { connect: async () => {}, destroy: async () => {}, getEntity: async () => peer, getMessages: async () => list, invoke: async () => ({}) } as unknown as TelegramClient;
  const config: Config = { key, production: false, origin: 'http://localhost:4173', host: '127.0.0.1', port: 4173, dbPath: ':memory:', apiId: 1, apiHash: 'a'.repeat(32), bot: 'u7_school_bot', botId: '100' };
  const bridge = new TelegramBridge(config, store, () => fake);
  try {
    assert.equal(effectiveRole(store.user('alice')!), 'user');
    await bridge.messages('alice', 'browser'); assert.equal(effectiveRole(store.user('alice')!), 'student');
    assert.equal(effectiveRole(store.user('bob')!), 'user');
    list = [message(2, 100, '📖 Вы не записаны ни на один поток'), ...list];
    await bridge.messages('alice', 'browser'); assert.equal(effectiveRole(store.user('alice')!), 'user');
    list = [list[1]]; // Denial fell outside the recent history window.
    await bridge.messages('alice', 'browser'); assert.equal(effectiveRole(store.user('alice')!), 'user');
    list = [message(3, 101, 'Моя учёба', 'step-view:my-study:continue', true)];
    await bridge.messages('alice', 'browser'); assert.equal(effectiveRole(store.user('alice')!), 'user');
    list = [message(4, 102, 'Моя учёба', 'step-view:my-study:continue')];
    await bridge.messages('alice', 'browser'); assert.equal(effectiveRole(store.user('alice')!), 'student');
    setUserRole(store, 'alice', 'admin');
    list = [message(5, 103, 'Ты покинул учёбу. Жаль, что не сложилось')];
    await bridge.messages('alice', 'browser'); assert.equal(effectiveRole(store.user('alice')!), 'mentor');
    setUserRole(store, 'bob', 'admin'); setUserRole(store, 'alice', 'student');
    assert.equal(effectiveRole(store.user('alice')!), 'user');
  } finally { await bridge.close(); store.close(); }
});
