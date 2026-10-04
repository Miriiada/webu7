import 'dotenv/config';
import path from 'node:path';
export interface Config { production: boolean; origin: string; host: string; port: number; key: Buffer; dbPath: string; apiId: number; apiHash: string; bot: string; botId: string; trustProxy?: string; basePath?: string; }
export function normalizeBasePath(value = '/'): string {
  if (value === '/') return value;
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\/?$/.test(value)) throw new Error('APP_BASE_PATH: укажите / или путь вида /web/');
  return value.endsWith('/') ? value : `${value}/`;
}
export function loadConfig(): Config {
  const production = process.env.NODE_ENV === 'production';
  const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:4173';
  const url = new URL(origin);
  if (url.origin !== origin) throw new Error('APP_ORIGIN должен содержать только origin');
  if (production && url.protocol !== 'https:') throw new Error('В production обязателен HTTPS');
  if (!production && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Режим разработки доступен только на loopback');
  const key = Buffer.from(process.env.MASTER_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('Сначала выполните npm run setup: нужен MASTER_KEY из 32 случайных байт');
  const host = process.env.HOST || '127.0.0.1';
  if (!production && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Режим разработки нельзя открывать в сеть');
  const bot = process.env.TELEGRAM_BOT_USERNAME || 'u7_school_bot';
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(bot)) throw new Error('Некорректное имя бота');
  const trustProxy = process.env.TRUST_PROXY || undefined;
  if (trustProxy && !/^(loopback|\d{1,3}(\.\d{1,3}){3})$/.test(trustProxy)) throw new Error('TRUST_PROXY: укажите точный IPv4 прокси или loopback');
  return { production, origin, host, port: Number(process.env.PORT || 4173), key, dbPath: path.resolve(process.env.DATABASE_PATH || './private/astra.sqlite'), apiId: Number(process.env.TELEGRAM_API_ID || 0), apiHash: process.env.TELEGRAM_API_HASH || '', bot, botId: process.env.TELEGRAM_BOT_ID || '', trustProxy, basePath: normalizeBasePath(process.env.APP_BASE_PATH) };
}
