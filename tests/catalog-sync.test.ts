import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../scripts/catalog-schema.js';
import { parseStep, completionEvidence } from '../server/progress.js';
import { historicalCatalog } from './fixtures/catalog.js';
import type { Catalog } from '../server/content.js';

function input(c: Catalog) {
  return [
    c.courses.map(x => ({ uuid: x.id, title: x.title, status: 'published', phases: [{ moduleIds: x.moduleIds }] })),
    c.modules.map(x => ({ uuid: x.id, title: x.title, status: 'published', projects: x.projects?.map(p => ({ ...p, uuid: p.id })) || [] })),
    c.lessons.map(x => ({ uuid: x.id, moduleId: x.moduleId, title: x.title, status: 'published', stepIds: x.stepIds })),
    c.steps.map(x => ({ uuid: x.id, description: x.title, status: 'published', content: x.content, code: x.code })),
  ];
}

test('Sync retains historical names by UUID across repeated renames; unrelated UUIDs do not inherit them', () => {
  const old = historicalCatalog(), updated = structuredClone(old);
  updated.modules[0].title = 'Алгоритмика: ядро';
  updated.modules[0].projects![0].title = 'Новый проект';
  updated.lessons[0].title = 'Новый урок';
  const once = normalize(input(updated), 'a'.repeat(40), old);
  assert.deepEqual(once.modules[0].aliases, ['Алгоритмика']);
  assert.deepEqual(once.modules[0].projects![0].aliases, [old.modules[0].projects![0].title]);
  assert.deepEqual(once.lessons[0].aliases, [old.lessons[0].title]);
  updated.modules[0].title = 'Алгоритмика: практика';
  const twice = normalize(input(updated), 'b'.repeat(40), once);
  assert.deepEqual(twice.modules[0].aliases, ['Алгоритмика', 'Алгоритмика: ядро']);
  assert.deepEqual(normalize(input(twice), 'c'.repeat(40), twice).modules[0].aliases, twice.modules[0].aliases);
  updated.modules[0].projects![0].id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  assert.equal(normalize(input(updated), 'd'.repeat(40), once).modules[0].projects![0].aliases, undefined);
  const detached = normalize(input(updated), 'e'.repeat(40));
  detached.modules[0].id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  assert.equal(normalize(input(detached), 'f'.repeat(40), old).modules[0].aliases, undefined);
});

test('Renamed curriculum recognizes old and new bot messages and reports; ambiguous names and changed steps stay rejected', () => {
  const old = historicalCatalog(), updated = structuredClone(old);
  const lesson = old.lessons.find(l => l.id === '01a09652-bf63-4ac1-b96d-7749abc1e543')!;
  const project = updated.modules[0].projects!.find(p => p.lessonIds.includes(lesson.id))!;
  const oldProject = project.title;
  updated.modules[0].title = 'Алгоритмика: ядро'; project.title = 'TDD и функции сравнения строк';
  updated.lessons.find(l => l.id === lesson.id)!.title = 'Проверка аргументов';
  const c = normalize(input(updated), 'a'.repeat(40), old);
  const text = `📖 Поток: Алгоритмика - 7\n📁 Проект: ${oldProject}\n📚 Урок: «${lesson.title}»\n📊 [████████░░] 4/5\n📝 Шаг 5 из 5: ${old.steps.find(s => s.id === lesson.stepIds[4])!.title}`;
  const parsed = parseStep({ text }, c)!;
  assert.equal(parsed.lesson.id, lesson.id);
  assert.deepEqual(parsed.completed, lesson.stepIds.slice(0, 4));
  const currentText = text.replace('Алгоритмика - 7', 'Алгоритмика: ядро - 7').replace(oldProject, project.title).replace(lesson.title, 'Проверка аргументов');
  assert.equal(parseStep({ text: currentText }, c)!.lesson.id, lesson.id);
  const messages = [text, `🎉 Урок «${lesson.title}» завершён!`].map((text, id) => ({ text, id, date: 100, buttons: [] }));
  assert.equal(completionEvidence(messages, c).size, 5);
  const report = `📊 Мой прогресс — Алгоритмика - 7\n▶️ Проект 3: ${oldProject} — [██████████] 5/5\n    ✅ ${lesson.title} — [██████████] 5/5`;
  assert.equal(completionEvidence([{ text: report, id: 1, date: 100, buttons: [] }], c).size, 5);
  assert.equal(parseStep({ text: text.replace('из 5', 'из 6') }, c), null);
  assert.equal(parseStep({ text: text.replace('Шаг 5 из 5:', 'Шаг 4 из 5:') }, c), null);
  assert.equal(parseStep({ text: text.replace(oldProject, 'Неизвестный проект') }, c), null);
  const ambiguous = structuredClone(c);
  ambiguous.modules.push({ ...structuredClone(c.modules[0]), id: 'other-module' });
  assert.equal(parseStep({ text }, ambiguous), null);
  assert.equal(completionEvidence([{ text: report, id: 1, date: 100, buttons: [] }], ambiguous).size, 0);
  c.modules[0].projects!.push({ ...project, id: 'other-project', aliases: [oldProject] });
  assert.equal(parseStep({ text }, c), null);
});
