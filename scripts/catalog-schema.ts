import { z } from 'zod';
import type { Catalog } from '../server/content.js';
// В исходных материалах есть UUID-подобные ID с нестандартными variant-битами.
const id = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i), text = z.string().max(300_000), status = z.string();
const courses = z.array(z.object({ uuid: id, title: text, description: text.optional(), status, phases: z.array(z.object({ moduleIds: z.array(id) })) }));
const modules = z.array(z.object({ uuid: id, title: text, description: text.optional(), status, projects: z.array(z.object({ uuid: id.optional(), title: text.optional(), status: status.optional(), lessonIds: z.array(id) })) }));
const lessons = z.array(z.object({ uuid: id, moduleId: id, title: text, status, estimatedMinutes: z.number().optional(), stepIds: z.array(id) }));
const steps = z.array(z.object({ uuid: id, description: text.optional(), status, content: text.optional(), code: text.optional(), kind: text.optional() }));
export function normalize(input: unknown[], revision: string): Catalog {
  const [c, m, l, s] = [courses.parse(input[0]), modules.parse(input[1]), lessons.parse(input[2]), steps.parse(input[3])] as const;
  const catalog: Catalog = {
    revision, source: 'https://github.com/a-kalki/u7-school', syncedAt: new Date().toISOString(),
    courses: c.filter(x => x.status === 'published').map(x => ({ id: x.uuid, title: x.title, description: x.description || '', moduleIds: x.phases.flatMap(p => p.moduleIds) })),
    modules: m.filter(x => x.status === 'published').map(x => ({ id: x.uuid, title: x.title, description: x.description || '', projects: x.projects.map(p => ({ id: p.uuid || '', title: p.title || '', status: p.status || 'published', lessonIds: p.lessonIds })), lessonIds: [...new Set(x.projects.filter(p => !p.status || p.status === 'published').flatMap(p => p.lessonIds))] })),
    lessons: l.filter(x => x.status === 'published').map(x => ({ id: x.uuid, moduleId: x.moduleId, title: x.title, minutes: x.estimatedMinutes || 0, stepIds: x.stepIds })),
    steps: s.filter(x => x.status === 'published').map(x => ({ id: x.uuid, title: x.description || 'Учебный шаг', content: x.content || '', code: x.code || '', kind: x.kind || 'text' })),
  };
  for (const collection of [catalog.courses, catalog.modules, catalog.lessons, catalog.steps]) if (new Set(collection.map(x => x.id)).size !== collection.length) throw new Error('Повторяющиеся ID в контенте');
  const moduleIds = new Set(catalog.modules.map(x => x.id)), lessonIds = new Set(catalog.lessons.map(x => x.id)), stepIds = new Set(catalog.steps.map(x => x.id));
  for (const c of catalog.courses) c.moduleIds = c.moduleIds.filter(id => moduleIds.has(id));
  for (const m of catalog.modules) m.lessonIds = m.lessonIds.filter(id => lessonIds.has(id));
  // Библиотека включает опубликованные уроки, ещё не включённые в проекты потока.
  for (const m of catalog.modules) m.lessonIds = [...new Set([...m.lessonIds, ...catalog.lessons.filter(l => l.moduleId === m.id).map(l => l.id)])];
  for (const l of catalog.lessons) l.stepIds = l.stepIds.filter(id => stepIds.has(id));
  return catalog;
}
