import type { Catalog } from './content.js';

// Project order is the curriculum order. The lessons file also contains older versions.
export function moduleLessons(catalog: Catalog, module: Catalog['modules'][number]) {
  const published = module.projects?.filter(p => !p.status || p.status === 'published');
  const activeIds = published?.length ? [...new Set(published.flatMap(p => p.lessonIds))] : module.lessonIds;
  const byId = new Map(catalog.lessons.map(l => [l.id, l]));
  const active = activeIds.map(id => byId.get(id)).filter((l): l is Catalog['lessons'][number] => !!l && l.moduleId === module.id);
  const ids = new Set(active.map(l => l.id));
  const archived = module.lessonIds.filter(id => !ids.has(id)).map(id => byId.get(id)).filter((l): l is Catalog['lessons'][number] => !!l);
  return { active, archived };
}
