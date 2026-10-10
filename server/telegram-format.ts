import { safeConvert, mdCodeBlock } from './mentor/markdown.js';
import { validateMarkdownV2 } from './mentor/markdown-validator.js';

export interface TextEntity { type: string; offset: number; length: number; url?: string; language?: string; }
export interface TelegramText { text: string; entities: TextEntity[]; }
const renderingCache = new Map<string, TelegramText>();
// Browser adapter only. Markdown conversion belongs to the mentor's unchanged code.
export function decodeMarkdownV2(source: string): TelegramText {
  let text = '', i = 0;
  const entities: TextEntity[] = [], stack: { token: string; type: string; offset: number }[] = [];
  const escaped = () => { const c = source[i + 1]; if (c && c.charCodeAt(0) <= 126) { text += c; i += 2; return true; } return false; };
  while (i < source.length) {
    if (source[i] === '\\' && escaped()) continue;
    if (source.startsWith('```', i) || source[i] === '`') {
      const marker = source.startsWith('```', i) ? '```' : '`', type = marker.length === 3 ? 'pre' : 'code';
      i += marker.length;
      let language: string | undefined;
      if (type === 'pre') { const line = source.indexOf('\n', i); if (line >= i) { language = source.slice(i, line).trim() || undefined; i = line + 1; } }
      const offset = text.length;
      while (i < source.length && !source.startsWith(marker, i)) {
        if (source[i] === '\\' && escaped()) continue;
        text += source[i++];
      }
      entities.push({ type, offset, length: text.length - offset, ...(language ? { language } : {}) }); i += marker.length; continue;
    }
    if (source[i] === '[') {
      // Link labels can contain formatting; parse them through the same adapter.
      let end = i + 1;
      while (end < source.length && source[end] !== ']') { end += source[end] === '\\' ? 2 : 1; }
      if (source.slice(end, end + 2) === '](') {
        let close = end + 2, url = '';
        while (close < source.length && source[close] !== ')') { if (source[close] === '\\' && close + 1 < source.length) close++; url += source[close++]; }
        if (close < source.length) {
          const label = decodeMarkdownV2(source.slice(i + 1, end)), offset = text.length;
          text += label.text; entities.push(...label.entities.map(e => ({ ...e, offset: e.offset + offset })), { type: 'texturl', offset, length: label.text.length, url });
          i = close + 1; continue;
        }
      }
    }
    if (source[i] === '>' && (i === 0 || source[i - 1] === '\n')) {
      const start = text.length;
      i++;
      const end = source.indexOf('\n', i), stop = end < 0 ? source.length : end;
      const quote = decodeMarkdownV2(source.slice(i, stop)); text += quote.text;
      entities.push(...quote.entities.map(e => ({ ...e, offset: e.offset + start })), { type: 'blockquote', offset: start, length: quote.text.length });
      i = stop; continue;
    }
    const token = source.startsWith('__', i) ? '__' : source.startsWith('||', i) ? '||' : source[i];
    const type = ({ '*': 'bold', '_': 'italic', '__': 'underline', '~': 'strike', '||': 'spoiler' } as Record<string, string>)[token];
    if (type) {
      const last = stack.at(-1);
      if (last?.token === token) { stack.pop(); entities.push({ type, offset: last.offset, length: text.length - last.offset }); }
      else stack.push({ token, type, offset: text.length });
      i += token.length; continue;
    }
    // Telegram uses CR to disambiguate adjacent underscore delimiters.
    if (source[i] !== '\r') text += source[i]; i++;
  }
  return { text, entities };
}
export function stepTelegramText(step: { kind: string; content: string; code: string }): TelegramText {
  const key = JSON.stringify([step.kind, step.content, step.code]);
  const cached = renderingCache.get(key); if (cached) return cached;
  // The upstream table preprocessor loops on an unmatched triple fence. Fail
  // closed before invoking it, without changing or repairing the source text.
  if (step.kind === 'text' && (step.content.match(/```/g)?.length || 0) % 2) return { text: 'Незакрытый блок кода в исходном Markdown. Требуется исправление материала.', entities: [] };
  const markdown = step.kind === 'code' && step.code ? mdCodeBlock(step.code) : step.kind === 'text' && step.content ? safeConvert(step.content) : '';
  const result = validateMarkdownV2(markdown);
  if (!result.valid) return { text: 'Бот не сможет отправить этот материал: ошибка MarkdownV2. Требуется исправление исходного материала.', entities: [] };
  const value = decodeMarkdownV2(markdown);
  if (renderingCache.size >= 1200) renderingCache.delete(renderingCache.keys().next().value!);
  renderingCache.set(key, value); return value;
}

// Compare only the material part of a real bot screen, never its changing progress header.
export function compareBotMaterial(step: Parameters<typeof stepTelegramText>[0], message: string): boolean | null {
  const body = message.match(/📝[^\n]*\n\n([\s\S]*)$/)?.[1];
  if (body === undefined) return null;
  const edgeNewlines = (text: string) => text.replace(/^\n+|\n+$/g, '');
  return edgeNewlines(body) === edgeNewlines(stepTelegramText(step).text);
}
