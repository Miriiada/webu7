import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCatalog } from '../server/content.js';
import { moduleLessons, lessonNeighbors, lessonMatchesSearch } from '../server/catalog-order.js';
import type { Catalog } from '../server/content.js';
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

test('Project groups preserve curriculum order without duplicate lessons; navigation crosses project and module boundaries but keeps archives separate', () => {
  const lesson = (id: string, moduleId = 'm1') => ({ id, moduleId, title: id, minutes: 0, stepIds: [] });
  const c: Catalog = { revision: 'a'.repeat(40), syncedAt: '', source: '', courses: [], steps: [], lessons: ['a', 'b', 'c', 'archive'].map(id => lesson(id)).concat(lesson('d', 'm2')), modules: [
    { id: 'm1', title: 'Module 1', description: '', lessonIds: ['a', 'b', 'c', 'archive'], projects: [
      { id: 'p1', title: 'Project 1', status: 'published', lessonIds: ['a', 'a', 'b'] },
      { id: 'p2', title: 'Project 2', status: 'published', lessonIds: ['b', 'c', 'd', 'missing'] },
      { id: 'old', title: 'Old project', status: 'archived', lessonIds: ['archive'] },
    ] },
    { id: 'm2', title: 'Module 2', description: '', lessonIds: ['d'] },
  ] };
  const groups = moduleLessons(c, c.modules[0]);
  assert(lessonMatchesSearch(c.modules[0], c.lessons[0], '  PROJECT 1  '));
  assert(!lessonMatchesSearch(c.modules[0], c.lessons[0], 'Project 2'));
  assert.deepEqual(groups.projects.map(p => [p.id, p.lessons.map(l => l.id)]), [['p1', ['a', 'b']], ['p2', ['c']]]);
  assert.deepEqual(groups.projects.flatMap(p => p.lessons.map(l => l.id)), groups.active.map(l => l.id));
  assert.equal(lessonNeighbors(c, 'b').next?.id, 'c');
  assert.equal(lessonNeighbors(c, 'c').next?.id, 'd');
  assert.equal(lessonNeighbors(c, 'd').previous?.id, 'c');
  assert.equal(lessonNeighbors(c, 'a').previous, undefined);
  assert.equal(lessonNeighbors(c, 'd').next, undefined);
  assert.deepEqual(lessonNeighbors(c, 'archive'), { previous: undefined, next: undefined });
  assert.deepEqual(lessonNeighbors(c, 'missing'), { previous: undefined, next: undefined });
});
