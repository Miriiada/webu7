import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
export interface UserRow { id: string; email: string; name: string; password: string; role: 'student' | 'admin'; totp: string | null; otp_last: number; telegram: string | null; telegram_id: string | null; telegram_name: string | null; created: number; }
export class Store {
  db: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, totp TEXT, otp_last INTEGER NOT NULL DEFAULT 0, telegram TEXT, telegram_id TEXT UNIQUE, telegram_name TEXT, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, created INTEGER NOT NULL, touched INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS actions (user_id TEXT NOT NULL REFERENCES users(id), fingerprint TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(user_id, fingerprint));
      CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS learning_steps (user_id TEXT NOT NULL REFERENCES users(id), telegram_id TEXT NOT NULL, step_id TEXT NOT NULL, evidence INTEGER NOT NULL, PRIMARY KEY(user_id,telegram_id,step_id));
      CREATE TABLE IF NOT EXISTS learning_history (user_id TEXT NOT NULL REFERENCES users(id), telegram_id TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, exhausted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,telegram_id));
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    if (!this.db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'role')) {
      this.db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','admin'))");
    }
    // Revisit history when the parser learns new evidence formats; retain confirmed marks.
    if (this.db.prepare("SELECT value FROM settings WHERE key='learning_parser_version'").get()?.value !== '2') {
      this.db.prepare('UPDATE learning_history SET cursor=0,exhausted=0').run();
      this.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('learning_parser_version','2')").run();
    }
    if (file !== ':memory:' && process.platform !== 'win32') chmodSync(file, 0o600);
  }
  user(id: string) { return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined; }
  email(email: string) { return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as unknown as UserRow | undefined; }
  audit(id: string, action: string) { this.db.prepare('INSERT INTO audit(user_id,action,created) VALUES(?,?,?)').run(id, action, Date.now()); }
  attempt(key: string, limit: number, interval: number) {
    const now = Date.now();
    this.db.prepare('DELETE FROM attempts WHERE until < ?').run(now);
    this.db.prepare('INSERT INTO attempts(key,count,until) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now + interval);
    return Number(this.db.prepare('SELECT count FROM attempts WHERE key=?').get(key)?.count) <= limit;
  }
  close() { this.db.close(); }
}
