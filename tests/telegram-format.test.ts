import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { TelegramText } from '../src/TelegramText.js';
import { decodeMarkdownV2, stepTelegramText, compareBotMaterial } from '../server/telegram-format.js';
import { safeConvert, mdCodeBlock } from '../server/mentor/markdown.js';
import { readCatalog } from '../server/content.js';
import { accessibleCatalog } from '../server/content-access.js';

test('Mentor conversion preserves code escapes, hard breaks, formatting and table transformation', () => {
  const code = 'const path = "C:\\temp";\nconst s = `hello ${name}`;\nconsole.log("\\n");';
  assert.equal(decodeMarkdownV2(mdCodeBlock(code)).text, code + '\n');
  const source = '**Важное**  \n_курсив_ и `a.b`\n\n| A | B |\n|---|---|\n| x() | [1] |\n';
  const value = stepTelegramText({ kind: 'text', content: source, code: '' });
  assert.deepEqual(value, decodeMarkdownV2(safeConvert(source)));
  assert(value.text.includes('• A | B')); assert(value.text.includes('x()'));
  assert(value.entities.some(e => e.type === 'bold')); assert(value.entities.some(e => e.type === 'code'));
  assert.equal(stepTelegramText({ kind: 'code', code, content: 'ignored by bot' }).text, code + '\n');
  assert(stepTelegramText({ kind: 'text', content: '```broken', code: '' }).text.includes('Незакрытый'));
  const step = { kind: 'code', code, content: '' };
  const message = `📖 Поток: Алгоритмика\n📝 Шаг 1 из 2: Пример\n\n${code}`;
  assert.equal(compareBotMaterial(step, message), true);
  assert.equal(compareBotMaterial(step, message.replace('\\temp', 'temp')), false);
  assert.equal(compareBotMaterial(step, 'Главное меню'), null);
});

test('Every catalog step converts without hanging; bodies and derived rendering are absent from public responses', () => {
  const c = readCatalog();
  for (const step of c.steps) { const value = stepTelegramText(step); assert.equal(typeof value.text, 'string'); assert(!value.text.includes('ошибка MarkdownV2'), step.title); }
  assert(accessibleCatalog(c).steps.every(s => !s.telegram && !s.content && !s.code));
  const p = { hasCourseAccess: false, completedStepIds: c.steps.map(s => s.id), completedLessonIds: c.lessons.map(l => l.id), current: null, modules: [], syncedAt: 0, notice: '', historyComplete: true };
  assert(accessibleCatalog(c, p).steps.every(s => !s.accessible && !s.telegram && !s.content));
  assert(accessibleCatalog(c, p, true).steps.every(s => s.accessible && s.telegram));
});

test('React renderer escapes markup and blocks executable links, including actual Telegram entities', () => {
  const text = '<img src=x onerror=alert(1)> click';
  const html = renderToStaticMarkup(createElement(TelegramText, { value: { text, entities: [{ type: 'texturl', offset: 0, length: text.length, url: 'javascript:alert(1)' }] } }));
  assert(!html.includes('<img')); assert(!html.includes('href=')); assert(html.includes('&lt;img'));
  const value = decodeMarkdownV2('*bold _inner_* [site](https://example.com)');
  const safe = renderToStaticMarkup(createElement(TelegramText, { value }));
  assert(safe.includes('<strong>')); assert(safe.includes('<em>')); assert(safe.includes('rel="noopener noreferrer"'));
});
