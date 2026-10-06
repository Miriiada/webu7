import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { normalize } from './catalog-schema.js';
import type { Catalog } from '../server/content.js';
import { checkMentorParser } from './mentor-parser.js';
const headers = { 'User-Agent': 'u7-astra-content-sync', Accept: 'application/vnd.github+json' };
async function json(url: string) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Источник недоступен: HTTP ${response.status}`);
  const reader = response.body!.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 12_000_000) { await reader.cancel(); throw new Error('Превышен лимит размера контента'); } chunks.push(value); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const commit = await json('https://api.github.com/repos/a-kalki/u7-school/commits/main');
if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('Некорректная ревизия GitHub');
if (process.argv.includes('--check')) {
  const current = JSON.parse(readFileSync('data/catalog.json', 'utf8')).revision;
  console.log(current === commit.sha ? `Материалы актуальны: ${current}` : `Есть новая ревизия: ${commit.sha}. Локальная: ${current}. Выполните npm run sync:content и проверьте результат.`);
} else {
  await checkMentorParser(commit.sha);
  const raw = await Promise.all(['courses', 'modules', 'lessons', 'steps'].map(name => json(`https://raw.githubusercontent.com/a-kalki/u7-school/${commit.sha}/data/courses/${name}.json`)));
  const previous: Catalog | undefined = existsSync('data/catalog.json') ? JSON.parse(readFileSync('data/catalog.json', 'utf8')) : undefined;
  const catalog = normalize(raw, commit.sha, previous);
  mkdirSync('data', { recursive: true }); writeFileSync('data/catalog.json.tmp', JSON.stringify(catalog)); renameSync('data/catalog.json.tmp', 'data/catalog.json');
  console.log(`Материалы обновлены: ${catalog.modules.length} модулей, ${catalog.lessons.length} уроков. Ревизия ${commit.sha}. Исходный код не исполнялся.`);
}
