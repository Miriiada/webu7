import type { Catalog } from './content.js';

export function lessonMatchesSearch(module: Catalog['modules'][number], lesson: Catalog['lessons'][number], query: string) {
  const projectTitles = module.projects?.filter(p => p.lessonIds.includes(lesson.id)).map(p => p.title) || [];
  return [module.title, ...projectTitles, lesson.title].join(' ').toLowerCase().includes(query.trim().toLowerCase());
}

// Project order is the curriculum order. The lessons file also contains older versions.
export function moduleLessons(catalog: Catalog, module: Catalog['modules'][number]) {
  const published = module.projects?.filter(p => !p.status || p.status === 'published');
  const activeIds = published?.length ? [...new Set(published.flatMap(p => p.lessonIds))] : module.lessonIds;
  const byId = new Map(catalog.lessons.map(l => [l.id, l]));
  const active = activeIds.map(id => byId.get(id)).filter((l): l is Catalog['lessons'][number] => !!l && l.moduleId === module.id);
  const ids = new Set(active.map(l => l.id));
  const archived = module.lessonIds.filter(id => !ids.has(id)).map(id => byId.get(id)).filter((l): l is Catalog['lessons'][number] => !!l);
  const assigned = new Set<string>();
  const projects = (published || []).map((project, index) => ({
    id: project.id || `project-${index}`, title: project.title || `Проект ${index + 1}`,
    lessons: project.lessonIds.flatMap(id => {
      const lesson = byId.get(id);
      if (!lesson || lesson.moduleId !== module.id || assigned.has(id)) return [];
      assigned.add(id); return [lesson];
    }),
  })).filter(project => project.lessons.length);
  return { active, archived, projects };
}

export function lessonNeighbors(catalog: Catalog, lessonId: string) {
  const module = catalog.modules.find(m => m.id === catalog.lessons.find(l => l.id === lessonId)?.moduleId);
  const groups = module && moduleLessons(catalog, module);
  // Archive versions have their own sequence and never interrupt the active curriculum.
  const sequence = groups?.archived.some(l => l.id === lessonId) ? groups.archived : catalog.modules.flatMap(m => moduleLessons(catalog, m).active);
  const index = sequence.findIndex(l => l.id === lessonId);
  return { previous: index > 0 ? sequence[index - 1] : undefined, next: index >= 0 ? sequence[index + 1] : undefined };
}
