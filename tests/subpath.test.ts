import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { normalizeBasePath, type Config } from '../server/config.js';

test('Base path rejects URLs, traversal and ambiguous prefixes', () => {
  assert.equal(normalizeBasePath(), '/');
  assert.equal(normalizeBasePath('/web'), '/web/');
  assert.equal(normalizeBasePath('/web/'), '/web/');
  for (const value of ['https://other.test', '//web', '/web/../', '/web?x=1', '/web%2f']) assert.throws(() => normalizeBasePath(value));
});

test('/web/: API and SPA stay under prefix; production cookie and CSRF survive login, renewal and logout', async () => {
  const origin = 'https://u7-hub.kz';
  const config: Config = { production: true, origin, basePath: '/web/', trustProxy: 'loopback', host: '127.0.0.1', port: 4173, key: randomBytes(32), dbPath: ':memory:', apiId: 0, apiHash: '', bot: 'u7_school_bot', botId: '' };
  const { app, store, bridge } = createApp(config);
  // SPA fallback must never claim sibling routes of the existing site.
  app.get('/{*path}', (_req, res) => res.send('SPA'));
  const get = (path: string) => request(app).get(path).set('Host', 'u7-hub.kz');
  const post = (path: string) => request(app).post(path).set('Host', 'u7-hub.kz').set('Origin', origin).set('X-U7-Request', '1');
  try {
    assert.equal((await get('/web')).headers.location, '/web/');
    assert.equal((await get('/web/')).text, 'SPA');
    assert.equal((await get('/web/lesson/example')).text, 'SPA');
    for (const path of ['/', '/api/public', '/web-other/', '/favicon.svg']) assert.equal((await get(path)).status, 404);
    assert.deepEqual((await get('/web/api/health')).body, { ok: true });
    const publicResponse = await get('/web/api/public?test=1');
    assert.equal(publicResponse.status, 200);
    assert(publicResponse.body.catalog.steps.every((step: { content: string }) => !step.content));
    assert.equal((await get('/web/api/me')).status, 401);
    const registration = await post('/web/api/auth/register').send({ email: 'subpath@example.test', name: 'Ученик', password: 'Subpath-password-test-1' });
    assert.equal(registration.status, 200);
    const cookieHeader = registration.headers['set-cookie'][0];
    assert.match(cookieHeader, /^__Secure-u7-web=/);
    assert.match(cookieHeader, /Path=\/web\//);
    assert.match(cookieHeader, /; Secure/);
    assert.match(cookieHeader, /HttpOnly/);
    const cookie = cookieHeader.split(';')[0];
    const me = await get('/web/api/me').set('Cookie', cookie);
    assert.equal(me.status, 200);
    assert.match(me.headers['set-cookie'][0], /Path=\/web\//);
    assert.equal((await post('/web/api/auth/logout').set('Cookie', cookie).send({})).status, 403);
    const logout = await post('/web/api/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', registration.body.csrf).send({});
    assert.equal(logout.status, 200);
    assert.match(logout.headers['set-cookie'][0], /Path=\/web\//);
    assert.equal((await get('/web/api/me').set('Cookie', cookie)).status, 401);
  } finally { await bridge.close(); store.close(); }
});
