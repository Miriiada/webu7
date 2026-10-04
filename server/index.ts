import express from 'express';
import path from 'node:path';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
const config = loadConfig();
const { app, store, bridge } = createApp(config);
app.use(express.static(path.resolve('dist'), { dotfiles: 'deny', index: false }));
app.get('/{*path}', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.sendFile(path.resolve('dist/index.html')); });
const server = app.listen(config.port, config.host, () => console.log(`U7 Astra: ${config.origin}`));
server.requestTimeout = 30_000;
const cleanup = setInterval(() => {
  const now = Date.now();
  store.db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
  store.db.prepare('DELETE FROM audit WHERE created<?').run(now - 90 * 86400_000);
  store.db.prepare("DELETE FROM actions WHERE status='acknowledged' AND created<?").run(now - 86400_000);
}, 60_000); cleanup.unref();
async function shutdown() { clearInterval(cleanup); server.close(); await bridge.close(); store.close(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
