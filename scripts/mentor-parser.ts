import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const mentorParserFiles = ['markdown.ts', 'markdown-validator.ts'];
export const parserHash = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
// Updating content must not silently diverge from the mentor's rendering pipeline.
// Fetch code as data and compare it; never execute newly downloaded upstream code.
export async function checkMentorParser(revision: string) {
  const sources = await Promise.all(mentorParserFiles.map(async file => {
    const response = await fetch(`https://raw.githubusercontent.com/a-kalki/u7-school/${revision}/packages/core/src/shared/${file}`, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Не удалось проверить парсер ментора: HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 100_000) throw new Error('Превышен лимит исходника парсера');
    return { file, text };
  }));
  for (const { file, text } of sources) {
    if (parserHash(text) !== parserHash(readFileSync(`server/mentor/${file}`, 'utf8'))) throw new Error(`Парсер ментора изменился (${file}). Сначала обновите и проверьте server/mentor. Материалы не перезаписаны.`);
  }
  const response = await fetch(`https://raw.githubusercontent.com/a-kalki/u7-school/${revision}/package.json`, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok) throw new Error('Не удалось проверить версию markdown-to-telegram');
  const upstream = await response.json();
  if (upstream.dependencies?.['markdown-to-telegram'] !== '^0.0.7') throw new Error('Ментор изменил зависимость markdown-to-telegram. Требуется проверка совместимости.');
  const lockResponse = await fetch(`https://raw.githubusercontent.com/a-kalki/u7-school/${revision}/bun.lock`, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!lockResponse.ok) throw new Error('Не удалось проверить lock-файл парсера ментора');
  const lock = await lockResponse.text();
  if (lock.length > 1_000_000 || !/"markdown-to-telegram":\s*\["markdown-to-telegram@0\.0\.7"/.test(lock)) throw new Error('Зафиксированная версия парсера ментора изменилась. Требуется проверка совместимости.');
}
