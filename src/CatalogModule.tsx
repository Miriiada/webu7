import { CheckCircle2, ChevronDown, ChevronRight, Clock3, FileText } from 'lucide-react';
import { moduleLessons, lessonMatchesSearch } from '../server/catalog-order.js';
import type { Catalog } from '../server/content.js';

export function CatalogModule({ catalog, module, index, search, expanded, toggle, count, doneSteps, doneLessons, currentLesson, viewedLesson, hasProgress, openLesson, expandedProjects, toggleProject }: {
  catalog: Catalog; module: Catalog['modules'][number]; index: number; search: string; expanded: boolean; toggle: () => void; count: string;
  doneSteps: Set<string>; doneLessons: Set<string>; currentLesson?: string; viewedLesson?: string; hasProgress: boolean; openLesson: (id: string) => void;
  expandedProjects: Set<string>; toggleProject: (key: string) => void;
}) {
  const groups = moduleLessons(catalog, module);
  const matches = (lesson: Catalog['lessons'][number]) => lessonMatchesSearch(module, lesson, search);
  const projects = groups.projects.map(project => ({ ...project, visible: project.lessons.filter(matches) })).filter(project => project.visible.length);
  const lessons = groups.active.filter(lesson => matches(lesson)), archived = groups.archived.filter(lesson => matches(lesson));
  if (!lessons.length && !archived.length && !projects.length) return null;
  const rows = (values: typeof lessons, sequence: typeof lessons) => <div className="lesson-list">{values.map(lesson => <button id={'lesson-' + lesson.id} key={lesson.id} className={viewedLesson === lesson.id ? 'lesson-viewed' : undefined} onClick={() => openLesson(lesson.id)}>
    <span className="lesson-number">{String(sequence.findIndex(l => l.id === lesson.id) + 1).padStart(2, '0')}</span>
    <span className={doneLessons.has(lesson.id) ? 'completion-mark' : ''}>{doneLessons.has(lesson.id) ? <CheckCircle2 size={20} aria-label="Урок выполнен"/> : <FileText size={18}/>}</span>
    <strong>{lesson.title}{currentLesson === lesson.id && <small className="current-lesson-label">Текущий урок</small>}{viewedLesson === lesson.id && <small className="viewed-lesson-label">Последний просмотренный урок</small>}</strong>
    <span className="lesson-info">{hasProgress ? lesson.stepIds.filter(id => doneSteps.has(id)).length + '/' + lesson.stepIds.length + ' шагов' : lesson.stepIds.length + ' шагов'}</span>
    {lesson.minutes > 0 && <span className="lesson-time"><Clock3 size={14}/>{lesson.minutes} мин</span>}<ChevronRight size={17}/>
  </button>)}</div>;
  return <section className="catalog-module">
    <button className="catalog-module-title module-toggle" aria-expanded={expanded} aria-controls={'module-' + module.id} onClick={toggle}>
      <span className={'module-symbol module-' + index}>{['JS', '{ }', '</>'][index % 3]}</span>
      <span className="module-caption"><span className="eyebrow">МОДУЛЬ {String(index + 1).padStart(2, '0')}</span><strong>{module.title}</strong><span className="module-description">{module.description}</span><span className="module-structure">{groups.projects.length ? groups.projects.length + ' ' + (groups.projects.length % 100 >= 11 && groups.projects.length % 100 <= 14 ? 'проектов' : groups.projects.length % 10 === 1 ? 'проект' : groups.projects.length % 10 >= 2 && groups.projects.length % 10 <= 4 ? 'проекта' : 'проектов') + ' · ' : ''}{groups.active.length} уроков</span></span>
      <span className="pill">{count}</span><ChevronDown size={20} className={expanded ? 'module-chevron expanded' : 'module-chevron'}/>
    </button>
    {expanded && <div id={'module-' + module.id}>
      {groups.projects.length ? projects.map(project => <section className="catalog-project" key={project.id} aria-labelledby={'project-' + module.id + '-' + project.id}>
        <button className="catalog-project-heading project-toggle" aria-expanded={!!search || expandedProjects.has(`${module.id}:${project.id}`)} aria-controls={`project-lessons-${module.id}-${project.id}`} onClick={() => toggleProject(`${module.id}:${project.id}`)}><span className="project-caption"><span className="eyebrow">ПРОЕКТ {String(groups.projects.findIndex(p => p.id === project.id) + 1).padStart(2, '0')}</span><strong id={'project-' + module.id + '-' + project.id}>{project.title}</strong></span><span>{hasProgress ? project.lessons.filter(l => doneLessons.has(l.id)).length + '/' + project.lessons.length + ' уроков выполнено' : project.lessons.length + ' уроков'}</span><ChevronDown size={18} className={search || expandedProjects.has(`${module.id}:${project.id}`) ? 'module-chevron expanded' : 'module-chevron'}/></button>
        {(!!search || expandedProjects.has(`${module.id}:${project.id}`)) && <div id={`project-lessons-${module.id}-${project.id}`}>{rows(project.visible, groups.active)}</div>}
      </section>) : rows(lessons, groups.active)}
      {archived.length > 0 && <details className="archive-lessons"><summary>Другие версии и дополнительные материалы ({archived.length})</summary><p>Эти уроки не входят в текущую опубликованную программу. Их отметки не переносятся между версиями автоматически.</p>{rows(archived, groups.archived)}</details>}
    </div>}
  </section>;
}
