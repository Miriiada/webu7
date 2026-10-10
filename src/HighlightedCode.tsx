import { useMemo, type ReactNode } from 'react';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
for (const [name, grammar] of Object.entries({ javascript, typescript, json, bash, xml, css, python, sql })) hljs.registerLanguage(name, grammar);
const aliases: Record<string, string> = { js: 'javascript', ts: 'typescript', html: 'xml', sh: 'bash', shell: 'bash', py: 'python' };
const names: Record<string, string> = { javascript: 'JavaScript', typescript: 'TypeScript', json: 'JSON', bash: 'Shell', xml: 'HTML / XML', css: 'CSS', python: 'Python', sql: 'SQL' };
const unescape = (text: string) => text.replace(/&(amp|lt|gt|quot|#x27);/g, (_, key: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'" }[key]!));
// Consume only highlighter-created span tags. No HTML insertion or DOM parsing.
export function highlightNodes(html: string): ReactNode[] {
  const root: ReactNode[] = [], stack: { className: string; children: ReactNode[] }[] = []; let key = 0;
  const append = (node: ReactNode) => (stack.at(-1)?.children || root).push(node);
  for (const part of html.split(/(<span class="[a-zA-Z0-9_ -]+">|<\/span>)/g)) {
    if (part.startsWith('<span class="')) stack.push({ className: part.slice(13, -2), children: [] });
    else if (part === '</span>' && stack.length) { const node = stack.pop()!; append(<span className={node.className} key={key++}>{node.children}</span>); }
    else if (part) append(unescape(part));
  }
  return root;
}
export function HighlightedCode({ code, language, inline = false }: { code: string; language?: string; inline?: boolean }) {
  const result = useMemo(() => {
    const hint = language?.toLowerCase(), selected = hint && (aliases[hint] || hint);
    if (selected && hljs.getLanguage(selected)) return { ...hljs.highlight(code, { language: selected, ignoreIllegals: true }), detected: false };
    if (selected) return { value: code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), language: undefined, detected: false };
    if (/^\s*(?:git|npm|npx|node|bun|pnpm|yarn|cd|mkdir|curl|sudo)\s/m.test(code)) return { ...hljs.highlight(code, { language: 'bash', ignoreIllegals: true }), detected: true };
    return { ...hljs.highlightAuto(code, ['javascript', 'typescript', 'json', 'bash', 'xml', 'css', 'python', 'sql']), detected: true };
  }, [code, language]);
  const contents = <code className="syntax-code">{highlightNodes(result.value)}</code>;
  return inline ? contents : <div className="code-block"><div className="code-language">{names[result.language || ''] || language || 'Код'}{result.detected && result.language && <small> · определён автоматически</small>}</div><pre className="telegram-pre">{contents}</pre></div>;
}
