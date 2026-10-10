import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CatalogModule } from '../src/CatalogModule.js';
import { HighlightedCode } from '../src/HighlightedCode.js';
import { StepNavigator } from '../src/StepNavigator.js';
import { readCatalog } from '../server/content.js';
import { moduleLessons, lessonLocation } from '../server/catalog-order.js';
import { decodeMarkdownV2 } from '../server/telegram-format.js';

test('Projects hide lesson rows by default and expand the target lesson project; search opens matching projects', () => {
  const catalog = readCatalog(), module = catalog.modules[1], project = moduleLessons(catalog, module).projects[0], lesson = project.lessons[0];
  const location = lessonLocation(catalog, lesson.id);
  assert.equal(location.moduleId, module.id); assert.equal(location.projectKey, `${module.id}:${project.id}`);
  const props = { catalog, module, index: 1, search: '', expanded: true, toggle: () => {}, count: '', doneSteps: new Set<string>(), doneLessons: new Set<string>(), hasProgress: false, openLesson: () => {}, expandedProjects: new Set<string>(), toggleProject: () => {} };
  const collapsed = renderToStaticMarkup(createElement(CatalogModule, props));
  assert(!collapsed.includes(`id="lesson-${lesson.id}"`)); assert(collapsed.includes('aria-expanded="false"'));
  const expanded = renderToStaticMarkup(createElement(CatalogModule, { ...props, expandedProjects: new Set([location.projectKey!]), currentLesson: lesson.id }));
  assert(expanded.includes(`id="lesson-${lesson.id}"`)); assert(expanded.includes('Текущий урок'));
  const searched = renderToStaticMarkup(createElement(CatalogModule, { ...props, search: lesson.title }));
  assert(searched.includes(`id="lesson-${lesson.id}"`));
});

test('Syntax highlighting preserves code and cannot introduce executable markup; explicit fence languages survive', () => {
  const source = 'const x = "<script>alert(1)</script>";\nconsole.log(`\\n${x}`);';
  const html = renderToStaticMarkup(createElement(HighlightedCode, { code: source, language: 'js' }));
  assert(html.includes('JavaScript')); assert(html.includes('hljs-keyword')); assert(!html.includes('<script>'));
  const text = html.slice(html.indexOf('<code')).replace(/^[^>]*>/, '').split('</code>')[0].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(text, source);
  assert.equal(decodeMarkdownV2('```typescript\nconst x: number = 1;\n```').entities[0].language, 'typescript');
  const shell = renderToStaticMarkup(createElement(HighlightedCode, { code: 'git add string-utils/replace.js\ngit commit -m "done"' }));
  assert(shell.includes('Shell')); assert(!shell.includes('TypeScript'));
});

test('Quick navigation lists every step including locked headings, with current and completed marks', () => {
  const steps = [{ id: 'a', title: 'First', kind: 'text', content: '', code: '' }, { id: 'b', title: 'Second', kind: 'text', content: '', code: '' }];
  const html = renderToStaticMarkup(createElement(StepNavigator, { steps, doneSteps: new Set(['a']), currentStep: 'b' }));
  assert(html.includes('Шаг 1: First · выполнен')); assert(html.includes('Шаг 2: Second')); assert(html.includes('aria-current="step"'));
});
