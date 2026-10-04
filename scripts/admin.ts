import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from '../server/config.js';
import { Store } from '../server/db.js';
const command = process.argv[2];
if (command === 'setup') {
  if (!existsSync('.env')) {
    mkdirSync('private', { recursive: true, mode: 0o700 });
    writeFileSync('.env', `NODE_ENV=development\nHOST=127.0.0.1\nPORT=4173\nAPP_ORIGIN=http://127.0.0.1:4173\nMASTER_KEY=${randomBytes(32).toString('base64')}\nDATABASE_PATH=./private/astra.sqlite\nTELEGRAM_API_ID=\nTELEGRAM_API_HASH=\nTELEGRAM_BOT_USERNAME=u7_school_bot\nTELEGRAM_BOT_ID=\n`, { mode: 0o600, flag: 'wx' });
    console.log('Создан .env с новым ключом. Ключ не выводится и не передаётся в браузер.');
  } else console.log('.env уже существует; ключ сохранён.');
  console.log('Заполните TELEGRAM_API_ID и TELEGRAM_API_HASH в .env, затем запустите сайт и создайте кабинет.');
} else if (command === 'forget-telegram') {
  const config = loadConfig(), store = new Store(config.dbPath), rl = createInterface({ input: stdin, output: stdout });
  const email = (await rl.question('Почта пользователя: ')).trim().toLowerCase(), user = store.email(email);
  if (!user) throw new Error('Пользователь не найден');
  const confirmed = await rl.question('Личность пользователя проверена вне сайта? Напишите RESET: ');
  if (confirmed === 'RESET') {
    store.db.prepare('UPDATE users SET telegram=NULL,telegram_id=NULL,telegram_name=NULL WHERE id=?').run(user.id);
    store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    store.audit(user.id, `admin.${command}`);
    console.log('Сброс выполнен. Перезапустите сервис, чтобы закрыть соединения в памяти. При сбросе Telegram отдельно завершите сессию U7 Astra в Telegram → Настройки → Устройства.');
  }
  rl.close(); store.close();
} else throw new Error('Команды: setup, forget-telegram');
