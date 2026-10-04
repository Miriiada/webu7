import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { seal, unseal, hashPassword, verifyPassword, safeUrl } from '../server/security.js';
test('AES-GCM: подмена, другой пользователь и другой ключ отклоняются', () => {
  const key = randomBytes(32), value = seal('telegram-session-secret', key, 'telegram:alice');
  assert.equal(unseal(value, key, 'telegram:alice'), 'telegram-session-secret');
  assert.notEqual(value, seal('telegram-session-secret', key, 'telegram:alice'));
  assert.throws(() => unseal(value, key, 'telegram:bob'));
  assert.throws(() => unseal(value, randomBytes(32), 'telegram:alice'));
  const parts = value.split('.'); parts[2] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => unseal(parts.join('.'), key, 'telegram:alice'));
});
test('Пароли не сохраняются открытым текстом; неверный пароль отклоняется', async () => {
  const hash = await hashPassword('correct long password'); assert(!hash.includes('correct'));
  assert(await verifyPassword('correct long password', hash)); assert(!await verifyPassword('incorrect password', hash));
});
test('URL кнопки не позволяет javascript, data и встраивание учётных данных', () => {
  assert.equal(safeUrl('javascript:alert(1)'), undefined); assert.equal(safeUrl('data:text/html,hello'), undefined);
  assert.equal(safeUrl('https://user:pass@example.com'), undefined); assert.equal(safeUrl('https://example.com/lesson'), 'https://example.com/lesson');
});
