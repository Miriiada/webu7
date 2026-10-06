import { stepTelegramText } from './telegram-format.js';
import type { Catalog } from './content.js';
import type { LearningProgress } from './progress.js';
import { moduleLessons } from './catalog-order.js';

// Titles remain public. Bodies are only included in the user's verified response.
export function accessibleCatalog(catalog: Catalog, progress?: LearningProgress, administrator = false): Catalog {
  if (administrator) return { ...catalog, steps: catalog.steps.map(step => ({ ...step, telegram: stepTelegramText(step), accessible: true })) };
  const allowed = new Set(progress?.hasCourseAccess !== true ? [] : progress?.completedLessonIds || []);
  const current = progress?.hasCourseAccess !== true ? undefined : catalog.lessons.find(l => l.id === progress?.current?.lessonId);
  if (current) {
    const module = catalog.modules.find(m => m.id === current.moduleId)!;
    const ordered = moduleLessons(catalog, module).active;
    const index = ordered.findIndex(l => l.id === current.id);
    for (const lesson of index >= 0 ? ordered.slice(0, index + 1) : [current]) allowed.add(lesson.id);
  }
  const steps = new Set(catalog.lessons.filter(l => allowed.has(l.id)).flatMap(l => l.stepIds));
  return { ...catalog, steps: catalog.steps.map(step => ({ ...step, content: steps.has(step.id) ? step.content : '', code: steps.has(step.id) ? step.code : '', telegram: steps.has(step.id) ? stepTelegramText(step) : undefined, accessible: steps.has(step.id) })) };
}
