import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
let hashing = 0;
async function derive(password: string, salt: string) {
  if (hashing >= 2) throw new AppError(503, 'AUTH_BUSY', 'Сервис входа занят. Попробуйте через несколько секунд.');
  hashing++;
  try { return await new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key))); }
  finally { hashing--; }
}
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function equal(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt);
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, value: string) {
  const [salt, expected] = value.split(':');
  if (!salt || !expected) return false;
  const hash = await derive(password, salt);
  return equal(hash.toString('hex'), expected);
}
export function seal(value: string, key: Buffer, context: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(b => b.toString('base64url')).join('.');
}
export function unseal(value: string, key: Buffer, context: string) {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Повреждён зашифрованный секрет');
  const [iv, tag, body] = parts.map(s => Buffer.from(s, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString('utf8');
}
export function safeUrl(value: string) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : undefined; } catch { return undefined; }
}
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
