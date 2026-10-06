/**
 * Валидатор MarkdownV2 для Telegram — линейный сканер.
 *
 * Роли функций:
 * - `escapeMarkdown` (markdown.ts) — producer: экранирует спецсимволы перед сборкой текста.
 * - `validateMarkdownV2` — диагностика: возвращает список issues без исключений.
 * - `assertMarkdownV2Safe` / `assertDialogResponseMarkdownSafe` — fail-fast: бросают
 *   `MarkdownV2ValidationError` (issues + фрагмент текста) в тестах и в проде
 *   перед отправкой в Telegram.
 *
 * Семантика Telegram (Bot API, MarkdownV2):
 *   - вне сущностей: любой символ с кодом 1–126 можно экранировать `\`;
 *     зарезервированные символы ДОЛЖНЫ быть экранированы;
 *   - внутри pre (```...```) и инлайн-кода (`...`) обязательны к экранированию
 *     только `` ` `` и `\` — прочие символы допустимы как есть;
 *   - `>` валиден в начале строки (blockquote), вне начала — экранируется;
 *   - ссылка `[label](url)` — защищённая зона: содержимое URL не проверяется.
 *
 * Почему линейный сканер, а не регулярки: регулярки с lookbehind на один
 * символ имеют слепую зону — в `\\!` слеш перед `!` уже потреблён парой `\\`,
 * фактически `!` голый (Telegram ответит 400). Сканер обрабатывает `\\X`
 * как пару и не пропускает такие случаи.
 */

/** Символы, которые НИКОГДА не форматируют текст и ВСЕГДА должны быть экранированы */
const NEVER_FORMATTING = new Set([
  '.',
  '!',
  '+',
  '-',
  '=',
  '|',
  '#',
  '{',
  '}',
  '(',
  ')',
  '[',
  ']',
]);

/** Максимальный код символа, который Telegram разрешает экранировать */
const MAX_ESCAPABLE_CHARCODE = 126;

/** Ссылка `[label](url)` — целиком защищённая зона */
const LINK_RE = /^\[[^\]]*\]\([^)]+\)/;

export interface MarkdownIssue {
  /** Проблемный символ */
  char: string;
  /** Причина: неэкранированный или непарный */
  reason: 'unescaped' | 'unpaired';
}

export interface MarkdownValidationResult {
  valid: boolean;
  issues: MarkdownIssue[];
}

/**
 * Проверяет MarkdownV2-текст на ошибки экранирования и парности
 * линейным сканером слева направо с тремя состояниями:
 *
 * - **outside**: `\X` поглощает 2 символа (X — код 1–126); голые
 *   зарезервированные символы — issue; `` ` `` открывает инлайн-код,
 *   ``` ``` ``` — пре-блок; `*` `_` `~` считаются для парности;
 *   `>` вне начала строки — issue.
 * - **inline**: валидны только `\`` и `\\`; голый ` закрывает;
 *   прочие `\X` — issue (внутри code экранируются только ` и \).
 * - **pre**: те же правила, что и inline; ``` закрывает блок;
 *   одиночный голый ` внутри — issue.
 *
 * Проверки (итоговые):
 * 1. Символы . ! + - = | > # { } ( ) [ ] вне кода — экранированы
 * 2. `\` экранирует только символы с кодом 1–126, `\` в конце — issue
 * 3. `*` `_` `~` вне кода — чётное количество (парные)
 * 4. Инлайн-код и пре-блок закрыты; внутри — только `\`` и `\\`
 * 5. Ссылки [text](url) — защищённая зона целиком
 */
export function validateMarkdownV2(text: string): MarkdownValidationResult {
  const issues: MarkdownIssue[] = [];
  const pairingCounts: Record<string, number> = { '*': 0, _: 0, '~': 0 };

  const unescaped = (char: string) =>
    issues.push({ char, reason: 'unescaped' });

  let mode: 'outside' | 'inline' | 'pre' = 'outside';
  let lineStart = true; // позиция в начале строки (blockquote-контекст)
  let i = 0;

  while (i < text.length) {
    const c = text.charAt(i);

    // ── Пре-блок: только \` и \\ валидны, ``` закрывает ──
    if (mode === 'pre') {
      if (c === '\\') {
        const next = text[i + 1];
        if (next !== '`' && next !== '\\') {
          unescaped('\\'); // голый \ внутри pre съедает следующий символ
        }
        i += 2;
        continue;
      }
      if (c === '`') {
        if (text.startsWith('```', i)) {
          mode = 'outside';
          i += 3;
          continue;
        }
        unescaped('`'); // одиночный бэктик внутри pre
      }
      i += 1;
      continue;
    }

    // ── Инлайн-код: только \` и \\ валидны, голый ` закрывает ──
    if (mode === 'inline') {
      if (c === '\\') {
        const next = text[i + 1];
        if (next !== '`' && next !== '\\') {
          unescaped('\\'); // внутри code экранируются только ` и \
        }
        i += 2;
        continue;
      }
      if (c === '`') {
        mode = 'outside';
      }
      i += 1;
      continue;
    }

    // ── Вне кода ──
    if (c === '\n') {
      lineStart = true;
      i += 1;
      continue;
    }

    if (c === '\\') {
      // Пара \X: X — любой символ с кодом 1–126 (правило Telegram)
      const next = text[i + 1];
      if (next === undefined || next.charCodeAt(0) > MAX_ESCAPABLE_CHARCODE) {
        unescaped('\\'); // \ в конце текста или перед не-ASCII
        i += 2;
      } else if (next === '\n') {
        unescaped('\\'); // \ перед переводом строки невалиден
        i += 1; // newline обработается отдельно — граница строки сохранится
      } else {
        i += 2;
      }
      lineStart = false;
      continue;
    }

    if (c === '`') {
      if (text.startsWith('```', i)) {
        mode = 'pre';
        i += 3;
      } else {
        mode = 'inline';
        i += 1;
      }
      lineStart = false;
      continue;
    }

    if (c === '[') {
      // Ссылка — защищённая зона целиком (в т.ч. символы в URL)
      const link = LINK_RE.exec(text.slice(i));
      if (link) {
        i += link[0].length;
        lineStart = false;
        continue;
      }
      unescaped('['); // [ без (...) — не ссылка, должен быть экранирован
      i += 1;
      lineStart = false;
      continue;
    }

    if (c === '>') {
      // Blockquote-маркер валиден только в начале строки
      if (!lineStart) {
        unescaped('>');
      }
      i += 1;
      lineStart = false;
      continue;
    }

    if (c in pairingCounts) {
      pairingCounts[c] = (pairingCounts[c] ?? 0) + 1;
    } else if (NEVER_FORMATTING.has(c)) {
      unescaped(c);
    }

    i += 1;
    lineStart = false;
  }

  // ── Итоги: парность и закрытость код-сущностей ──
  if (mode === 'inline' || mode === 'pre') {
    issues.push({ char: '`', reason: 'unpaired' });
  }
  for (const [char, count] of Object.entries(pairingCounts)) {
    if (count % 2 !== 0) {
      issues.push({ char, reason: 'unpaired' });
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Ошибка невалидного MarkdownV2-текста.
 *
 * Несёт список issues и фрагмент проблемного текста — достаточно для
 * диагностики по логам. Бросается fail-fast проверками
 * (`assertMarkdownV2Safe` / `assertDialogResponseMarkdownSafe`) как в тестах,
 * так и в продакшене (`executeResponses` → глобальный обработчик).
 */
export class MarkdownV2ValidationError extends Error {
  /** Список проблем валидации (символ + причина) */
  readonly issues: MarkdownIssue[];

  /** Фрагмент проблемного текста (первые символы) для диагностики */
  readonly textSnippet: string;

  constructor(issues: MarkdownIssue[], text: string, snippetLength = 200) {
    const details = issues
      .map(
        (i) =>
          `${i.reason === 'unescaped' ? 'неэкранированный' : 'непарный'} '${i.char}'`,
      )
      .join(', ');
    super(
      `MarkdownV2 validation failed (${issues.length} issue(s)): ${details}\nText: ${text.slice(0, snippetLength)}`,
    );
    this.name = 'MarkdownV2ValidationError';
    this.issues = issues;
    this.textSnippet = text.slice(0, snippetLength);
  }
}

/**
 * Бросает `MarkdownV2ValidationError`, если MarkdownV2-текст содержит
 * неэкранированные символы или непарное форматирование.
 * Fail-fast: используется в тестах и в проде перед отправкой.
 */
export function assertMarkdownV2Safe(text: string): void {
  const result = validateMarkdownV2(text);
  if (!result.valid) {
    throw new MarkdownV2ValidationError(result.issues, text);
  }
}
