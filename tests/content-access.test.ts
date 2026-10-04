import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessibleCatalog } from '../server/content-access.js';
import { readCatalog } from '../server/content.js';
import { moduleLessons } from '../server/catalog-order.js';
import type { LearningProgress } from '../server/progress.js';

test('Public titles contain no material bodies or code', () => {
  const catalog = readCatalog(), publicCatalog = accessibleCatalog(catalog);
  assert(publicCatalog.steps.every(s => s.title && !s.content && !s.code && !s.accessible));
  assert(catalog.steps.some(s => s.content));
});
test('Only confirmed lessons and current module prefix are opened; future and other modules stay closed', () => {
  const c = readCatalog(), module = c.modules[1], lessons = moduleLessons(c, module).active;
  const current = lessons[2];
  const progress: LearningProgress = { completedLessonIds: [], completedStepIds: [], modules: [], historyComplete: true, syncedAt: Date.now(), notice: '', current: { lessonId: current.id, stepId: current.stepIds[0], title: '', stream: '' } };
  const result = accessibleCatalog(c, progress);
  const allowed = new Set(lessons.slice(0, 3).flatMap(l => l.stepIds));
  for (const step of result.steps) {
    assert.equal(step.accessible, allowed.has(step.id));
    if (!allowed.has(step.id)) { assert.equal(step.content, ''); assert.equal(step.code, ''); }
  }
});
