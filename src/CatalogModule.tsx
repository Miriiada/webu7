import { CheckCircle2, ChevronDown, ChevronRight, Clock3, FileText } from 'lucide-react';
import { moduleLessons } from '../server/catalog-order';
import type { Catalog } from './api';

export function CatalogModule({ catalog, module, index, search, expanded, toggle, count, doneSteps, doneLessons, currentLesson, hasProgress, openLesson }: {
  catalog: Catalog; module: Catalog['modules'][number]; index: number; search: string; expanded: boolean; toggle: () => void; count: string;
  doneSteps: Set<string>; doneLessons: Set<string>; currentLesson?: string; hasProgress: boolean; openLesson: (id: string) => void;
}) {
  const groups = moduleLessons(catalog, module);
  const matches = (lesson: Catalog['lessons'][number]) => !search || `${module.title} ${lesson.title}`.toLowerCase().includes(search.toLowerCase());
  const lessons = groups.active.filter(matches), archived = groups.archived.filter(matches);
  if (!lessons.length && !archived.length) return null;
  const rows = (values: typeof lessons) => <div className="lesson-list">{values.map((lesson, number) => <button id={`lesson-${lesson.id}`} key={lesson.id} onClick={() => openLesson(lesson.id)}><span className="lesson-number">{String(number + 1).padStart(2, '0')}</span><span className={doneLessons.has(lesson.id) ? 'completion-mark' : ''}>{doneLessons.has(lesson.id) ? <CheckCircle2 size={20} aria-label="Урок выполнен"/> : <FileText size={18}/>}</span><strong>{lesson.title}{currentLesson === lesson.id && <small className="current-lesson-label">Текущий урок</small>}</strong><span className="lesson-info">{hasProgress ? `${lesson.stepIds.filter(id => doneSteps.has(id)).length}/${lesson.stepIds.length} шагов` : `${lesson.stepIds.length} шагов`}</span>{lesson.minutes > 0 && <span className="lesson-time"><Clock3 size={14}/>{lesson.minutes} мин</span>}<ChevronRight size={17}/></button>)}</div>;
  return <section className="catalog-module"><button className="catalog-module-title module-toggle" aria-expanded={expanded} aria-controls={`module-${module.id}`} onClick={toggle}><span className={`module-symbol module-${index}`}>{['JS', '{ }', '</>'][index % 3]}</span><span className="module-caption"><span className="eyebrow">МОДУЛЬ {String(index + 1).padStart(2, '0')}</span><strong>{module.title}</strong><span className="module-description">{module.description}</span></span><span className="pill">{count}</span><ChevronDown size={20} className={expanded ? 'module-chevron expanded' : 'module-chevron'}/></button>
    {expanded && <div id={`module-${module.id}`}>{rows(lessons)}{archived.length > 0 && <details className="archive-lessons"><summary>Другие версии и дополнительные материалы ({archived.length})</summary><p>Эти уроки не входят в текущую опубликованную программу. Их отметки не переносятся между версиями автоматически.</p>{rows(archived)}</details>}</div>}
  </section>;
}
