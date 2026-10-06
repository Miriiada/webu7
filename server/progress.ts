import type { Catalog } from './content.js';
import type { BotMessage } from './telegram.js';

const clean = (s: string) => s.normalize('NFKC').replace(/\\([_*\[\]()~`>#+\-=|{}.!])/g, '$1').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
const names = (item: { title: string; aliases?: string[] }) => [item.title, ...(item.aliases || [])].map(clean);
const matchesTitle = (item: { title: string; aliases?: string[] }, title: string) => names(item).includes(clean(title));
function streamModule(catalog: Catalog, stream: string) {
  const value = clean(stream);
  const matches = catalog.modules.filter(m => names(m).some(title => value === title || value.startsWith(title + ' -')));
  return matches.length === 1 ? matches[0] : undefined;
}
function streamProject(module: Catalog['modules'][number] | undefined, title: string) {
  const matches = module?.projects?.filter(p => matchesTitle(p, title)) || [];
  return matches.length === 1 ? matches[0] : undefined;
}
export function parseStep(message: Pick<BotMessage, 'text'>, catalog: Catalog) {
  const text = message.text;
  const stream = text.match(/Поток:\s*([^\n]+)/)?.[1];
  const project = text.match(/Проект:\s*([^\n]+)/)?.[1];
  const lessonTitle = text.match(/Урок:\s*«([^\n]+)»/)?.[1];
  const step = text.match(/Шаг\s+(\d+)\s+из\s+(\d+):\s*([^\n]+)/);
  const count = text.match(/📊[^\n]*?\b(\d+)\s*\/\s*(\d+)/);
  if (!stream || !project || !lessonTitle || !step) return null;
  const index = Number(step[1]) - 1, total = Number(step[2]);
  const module = streamModule(catalog, stream), selectedProject = streamProject(module, project);
  const candidates = catalog.lessons.filter(l => {
    return matchesTitle(l, lessonTitle) && l.stepIds.length === total && index >= 0 && index < total
      && module?.id === l.moduleId && selectedProject?.lessonIds.includes(l.id)
      && clean(catalog.steps.find(s => s.id === l.stepIds[index])?.title || '') === clean(step[3]);
  });
  if (candidates.length !== 1) return null;
  const lesson = candidates[0];
  return { lesson, stepId: lesson.stepIds[index], index, stream: clean(stream), project: clean(project),
    completed: count && Number(count[2]) === total && Number(count[1]) === total ? [...lesson.stepIds] : count && Number(count[2]) === total && Number(count[1]) === index ? lesson.stepIds.slice(0, index) : [] };
}

export function isCompleteButton(text: string) { return /^✅\s*Выполнено\s*$/.test(text); }
export function transitionCompletes(text: string, previous: NonNullable<ReturnType<typeof parseStep>>) {
  const title = text.match(/Урок\s*«([^\n]+)»\s*заверш[её]н/)?.[1];
  const project = text.match(/Проект\s*«([^»]+)»\s*заверш[её]н/)?.[1];
  return previous.index === previous.lesson.stepIds.length - 1 && ((!!title && matchesTitle(previous.lesson, title)) || (!!project && clean(project) === previous.project) || /Поток полностью заверш[её]н/.test(text));
}
export function completionEvidence(messages: BotMessage[], catalog: Catalog) {
  const completed = new Map<string, number>();
  let previous: ReturnType<typeof parseStep> = null;
  for (const m of [...messages].sort((a, b) => a.id - b.id)) {
    const reportStream = m.text.match(/📊\s*Мой прогресс\s*[—–-]\s*([^\n]+)/)?.[1];
    if (reportStream) {
      const module = streamModule(catalog, reportStream);
      let project: NonNullable<Catalog['modules'][number]['projects']>[number] | undefined;
      for (const line of m.text.split('\n')) {
        const heading = line.match(/Проект\s+\d+:\s*(.+?)\s*[—–]\s*\[/);
        if (heading) { project = streamProject(module, heading[1]); continue; }
        const row = line.match(/^\s*✅\s*(.+?)\s*[—–]\s*\[[^\]]*\]\s*(\d+)\/(\d+)\s*$/);
        if (!row || !project || Number(row[2]) !== Number(row[3])) continue;
        const matches = catalog.lessons.filter(l => project!.lessonIds.includes(l.id) && matchesTitle(l, row[1]) && l.stepIds.length === Number(row[3]));
        if (matches.length === 1) for (const id of matches[0].stepIds) completed.set(id, m.id);
      }
    }
    const parsed = parseStep(m, catalog);
    if (parsed) {
      for (const id of parsed.completed) completed.set(id, m.id);
      previous = parsed;
    } else if (previous && transitionCompletes(m.text, previous)) {
      for (const id of previous.lesson.stepIds) completed.set(id, m.id);
    }
  }
  return completed;
}

export interface LearningProgress {
  catalog?: Catalog;
  completedStepIds: string[];
  completedLessonIds: string[];
  modules: { id: string; completed: number; total: number }[];
  current: { lessonId: string; stepId: string; title: string; stream: string; ticket?: string } | null;
  historyComplete: boolean;
  syncedAt: number;
  notice: string;
}
