import { Fragment, type ReactNode } from 'react';
import type { TelegramText as FormattedText, TextEntity } from '../server/telegram-format.js';
import { HighlightedCode } from './HighlightedCode.js';

const allowedUrl = (value?: string) => { try { const url = new URL(value || ''); return ['https:', 'http:', 'tg:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } };
export function TelegramText({ value }: { value: FormattedText }) {
  const entities = value.entities.filter(e => Number.isInteger(e.offset) && Number.isInteger(e.length) && e.offset >= 0 && e.length > 0 && e.offset + e.length <= value.text.length);
  function wrap(entity: TextEntity, children: ReactNode): ReactNode {
    switch (entity.type) {
      case 'bold': return <strong>{children}</strong>;
      case 'italic': return <em>{children}</em>;
      case 'underline': return <u>{children}</u>;
      case 'strike': return <s>{children}</s>;
      case 'code': return <HighlightedCode code={value.text.slice(entity.offset, entity.offset + entity.length)} language={entity.language} inline/>;
      case 'pre': return <HighlightedCode code={value.text.slice(entity.offset, entity.offset + entity.length)} language={entity.language}/>;
      case 'blockquote': return <blockquote className="telegram-quote">{children}</blockquote>;
      case 'spoiler': return <span className="telegram-spoiler" tabIndex={0} title="Спойлер">{children}</span>;
      case 'url': { const href = allowedUrl(value.text.slice(entity.offset, entity.offset + entity.length)); return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : children; }
      case 'texturl': { const href = allowedUrl(entity.url); return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : children; }
      default: return children;
    }
  }
  function range(start: number, end: number, remaining: TextEntity[], depth = 0): ReactNode {
    if (depth > 24) return value.text.slice(start, end);
    const ordered = remaining.filter(e => e.offset >= start && e.offset + e.length <= end).sort((a, b) => a.offset - b.offset || b.length - a.length);
    const nodes: ReactNode[] = []; let cursor = start;
    for (const entity of ordered) {
      if (entity.offset < cursor) continue;
      if (entity.offset > cursor) nodes.push(value.text.slice(cursor, entity.offset));
      nodes.push(<Fragment key={`${depth}-${entity.offset}-${entity.type}`}>{wrap(entity, range(entity.offset, entity.offset + entity.length, remaining.filter(e => e !== entity), depth + 1))}</Fragment>);
      cursor = entity.offset + entity.length;
    }
    if (cursor < end) nodes.push(value.text.slice(cursor, end));
    return nodes;
  }
  return <div className="prose telegram-text">{range(0, value.text.length, entities)}</div>;
}
