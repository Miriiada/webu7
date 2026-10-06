import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { setUserRole } from '../server/roles.js';
import type { Config } from '../server/config.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/db.js';

test('Legacy users retain accounts and encrypted Telegram data; migration grants student role and is repeatable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'u7-role-migration-'));
  const file = join(directory, 'legacy.sqlite');
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec('CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,totp TEXT,otp_last INTEGER NOT NULL DEFAULT 0,telegram TEXT,telegram_id TEXT UNIQUE,telegram_name TEXT,created INTEGER NOT NULL)');
    legacy.prepare('INSERT INTO users(id,email,name,password,telegram,created) VALUES(?,?,?,?,?,?)').run('legacy', 'legacy@example.test', 'Ученик', 'password-hash', 'encrypted-session', 123);
    legacy.close();
    const first = new Store(file);
    assert.equal(first.user('legacy')!.role, 'student');
    assert.equal(first.user('legacy')!.telegram, 'encrypted-session');
    assert.equal(first.user('legacy')!.password, 'password-hash');
    setUserRole(first, 'legacy', 'admin'); first.close();
    const second = new Store(file);
    assert.equal(second.user('legacy')!.role, 'admin'); second.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('Roles: no self-promotion, protected admin endpoints, full catalog, immediate revocation, last-admin protection', async () => {
  const origin = 'http://127.0.0.1:4173';
  const config: Config = { production: false, origin, host: '127.0.0.1', port: 4173, key: randomBytes(32), dbPath: ':memory:', apiId: 0, apiHash: '', bot: 'u7_school_bot', botId: '' };
  const { app, store, bridge } = createApp(config);
  const headers = { Host: '127.0.0.1:4173', Origin: origin, 'X-U7-Request': '1' };
  const body = { name: 'Учитель', email: 'admin@example.test', password: 'Long-password-for-role-test' };
  try {
    assert.equal((await request(app).get('/api/admin/users').set(headers)).status, 401);
    assert.equal((await request(app).post('/api/auth/register').set(headers).send({ ...body, role: 'admin' })).status, 400);
    const a = await request(app).post('/api/auth/register').set(headers).send(body);
    const cookieA = a.headers['set-cookie'][0].split(';')[0];
    assert.equal(a.body.user.role, 'student');
    assert.equal((await request(app).get('/api/admin/users').set(headers).set('Cookie', cookieA)).status, 403);
    setUserRole(store, a.body.user.id, 'admin'); // Bootstrap requires access to the server, never registration.
    const me = await request(app).get('/api/me').set(headers).set('Cookie', cookieA);
    assert.equal(me.body.user.role, 'admin');
    assert(me.body.catalog.steps.every((step: { accessible: boolean }) => step.accessible));
    assert(me.body.catalog.steps.some((step: { content: string }) => step.content));
    const publicCatalog = await request(app).get('/api/public').set(headers).set('Cookie', cookieA);
    assert(publicCatalog.body.catalog.steps.every((step: { content: string }) => !step.content));
    const b = await request(app).post('/api/auth/register').set(headers).send({ ...body, name: 'Ученик', email: 'student@example.test' });
    const cookieB = b.headers['set-cookie'][0].split(';')[0];
    const roleUrl = `/api/admin/users/${b.body.user.id}/role`;
    assert.equal((await request(app).patch(roleUrl).set(headers).set('Cookie', cookieA).send({ role: 'admin' })).status, 403);
    assert.equal((await request(app).patch(roleUrl).set(headers).set('Cookie', cookieB).set('X-CSRF-Token', b.body.csrf).send({ role: 'admin' })).status, 403);
    const change = (id: string, role: string) => request(app).patch(`/api/admin/users/${id}/role`).set(headers).set('Cookie', cookieA).set('X-CSRF-Token', a.body.csrf).send({ role });
    assert.equal((await change(a.body.user.id, 'student')).status, 409);
    assert.equal(store.user(a.body.user.id)!.role, 'admin');
    assert.equal((await change(b.body.user.id, 'owner')).status, 400);
    assert.equal((await change(b.body.user.id, 'admin')).status, 200);
    assert.equal((await request(app).get('/api/admin/users').set(headers).set('Cookie', cookieB)).status, 200);
    assert.equal((await change(b.body.user.id, 'student')).status, 200);
    assert.equal((await request(app).get('/api/admin/users').set(headers).set('Cookie', cookieB)).status, 403);
    const student = await request(app).get('/api/me').set(headers).set('Cookie', cookieB);
    assert(student.body.catalog.steps.every((step: { content: string; accessible: boolean }) => !step.content && !step.accessible));
    const users = await request(app).get('/api/admin/users').set(headers).set('Cookie', cookieA);
    assert.equal(users.body.total, 2);
    assert(!JSON.stringify(users.body).includes('password'));
    assert(!JSON.stringify(users.body).includes('csrf'));
    assert.equal((await request(app).patch('/api/profile').set(headers).set('Cookie', cookieB).set('X-CSRF-Token', b.body.csrf).send({ name: 'Ученик', role: 'admin' })).status, 400);
  } finally { await bridge.close(); store.close(); }
});
