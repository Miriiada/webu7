import type { Catalog } from './content.js';
import type { LearningProgress } from './progress.js';
import { moduleLessons } from './catalog-order.js';

// Titles remain public. Bodies are only included in the user's verified response.
export function accessibleCatalog(catalog: Catalog, progress?: LearningProgress): Catalog {
  const allowed = new Set(progress?.completedLessonIds || []);
  const current = catalog.lessons.find(l => l.id === progress?.current?.lessonId);
  if (current) {
    const module = catalog.modules.find(m => m.id === current.moduleId)!;
    const ordered = moduleLessons(catalog, module).active;
    const index = ordered.findIndex(l => l.id === current.id);
    for (const lesson of index >= 0 ? ordered.slice(0, index + 1) : [current]) allowed.add(lesson.id);
  }
  const steps = new Set(catalog.lessons.filter(l => allowed.has(l.id)).flatMap(l => l.stepIds));
  return { ...catalog, steps: catalog.steps.map(step => ({ ...step, content: steps.has(step.id) ? step.content : '', code: steps.has(step.id) ? step.code : '', accessible: steps.has(step.id) })) };
}
