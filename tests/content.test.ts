import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCatalog } from '../server/content.js';
import { moduleLessons } from '../server/catalog-order.js';
import { historicalCatalog } from './fixtures/catalog.js';

test('Алгоритмика показывает действующие уроки по проектам, архивные дубликаты отдельно', () => {
  const c = historicalCatalog(), m = c.modules.find(m => m.title === 'Алгоритмика')!;
  const { active, archived } = moduleLessons(c, m);
  assert.equal(active[0].id, 'b27b637c-2021-4eaf-895a-c32120416f0c');
  assert.equal(active[2].title, 'Первый коммит');
  assert.equal(active.find(l => l.title === 'Обработка ошибок: throw и try-catch')!.id, '01a09652-bf63-4ac1-b96d-7749abc1e543');
  assert(archived.some(l => l.id === 'e89a960b-2293-42e3-be57-8890485a7003'));
  assert.equal(new Set([...active, ...archived].map(l => l.id)).size, m.lessonIds.length);
});
test('Все опубликованные уроки текущих модулей доступны из библиотеки', () => {
  const c = readCatalog(), modules = new Set(c.modules.map(m => m.id));
  const available = new Set(c.modules.flatMap(m => m.lessonIds));
  for (const l of c.lessons) if (modules.has(l.moduleId)) assert(available.has(l.id), `Не доступен урок ${l.title}`);
  const ids = new Set(c.steps.map(s => s.id));
  for (const l of c.lessons) for (const id of l.stepIds) assert(ids.has(id));
  assert.match(c.revision, /^[a-f0-9]{40}$/);
});
