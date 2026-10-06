import { convert } from 'markdown-to-telegram';

// ── MdText — безопасный MarkdownV2 ──

/**
 * Брендированный тип «безопасного» MarkdownV2-текста для Telegram.
 *
 * Производится ТОЛЬКО хелперами `md`/`mdRaw`: доменные данные вставляются
 * через `${}`-интерполяцию `md` и экранируются автоматически. Присвоить
 * обычную строку в поля `Screen.text` и `NotificationPayload.text`
 * компилятор не даст — забывание экранирования невозможно типами.
 */
export type MdText = string & { readonly __md: never };

/**
 * Тегированный шаблон безопасного MarkdownV2.
 *
 * Литеральные части проходят как есть (разметка разрешена и остаётся
 * на совести автора текста), интерполированные `${значения}` экранируются
 * целиком — доменные данные не могут сломать разметку.
 *
 * @example
 * const name = 'Иван_5';
 * md`Привет, *${name}*!` // 'Привет, *Иван\\_5*!'
 */
export function md(
  strings: TemplateStringsArray,
  ...values: unknown[]
): MdText {
  let result = '';
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) {
      result += escapeMarkdown(String(values[i]));
    }
  }
  return result as MdText;
}

/**
 * Явный «этот текст уже корректный MarkdownV2» (редкие случаи: вставка
 * заранее размеченного блока). Ответственность за экранирование — на
 * вызывающем.
 */
export function mdRaw(text: string): MdText {
  return text as MdText;
}

/**
 * Конкатенация MdText-фрагментов — композиция разметки.
 *
 * Бренд MdText существует только в типах, поэтому `md`-интерполяция не может
 * отличить «уже безопасный» фрагмент и экранирует его повторно. Склейку
 * готовых MdText делайте здесь — без повторного экранирования.
 */
export function mdConcat(...parts: MdText[]): MdText {
  return parts.join('') as MdText;
}

/** Склейка MdText-строк с разделителем (по умолчанию \n) — композиция. */
export function mdJoin(parts: MdText[], separator = '\n'): MdText {
  return parts.join(separator) as MdText;
}

/**
 * Экранирует текст по правилам code/pre-entity Telegram:
 * внутри инлайн-кода и пре-блока обязательны к экранированию
 * только `` ` `` и `\`.
 *
 * Порядок важен: сначала удваиваем `\`, потом экранируем бэктики —
 * иначе бэктик-экранирующий `\` сам был бы удвоен.
 */
function escapeCodeEntity(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

/**
 * Безопасный пре-блок (```...```) из доменных данных.
 *
 * Содержимое экранируется по правилам pre-entity Telegram (` и \).
 * Голый `\` внутри pre «съедает» сам себя и следующий символ
 * (`\n` в коде урока рендерился бы как `n`), голый `` ` `` —
 * преждевременно закрывает блок.
 *
 * @example
 * mdCodeBlock("console.log('\\n=== Оклады ===')")
 * // '```\nconsole.log(\'\\\\n=== Оклады ===\')\n```'
 */
export function mdCodeBlock(code: string): MdText {
  return mdRaw(`\`\`\`\n${escapeCodeEntity(code)}\n\`\`\``);
}

/**
 * Безопасный инлайн-код (`...`) из доменных данных.
 * Те же два экранирования, что и в mdCodeBlock: `` ` `` и `\`.
 *
 * @example
 * mdInlineCode('a ` b') // '`a \\` b`'
 */
export function mdInlineCode(text: string): MdText {
  return mdRaw(`\`${escapeCodeEntity(text)}\``);
}

/**
 * Экранирует спецсимволы MarkdownV2 для Telegram.
 *
 * MarkdownV2 резервирует символы: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * и обратный слеш `\`: любой из них в plain text должен быть
 * экранирован — иначе Telegram либо отвечает 400 (зарезервированный
 * символ), либо «съедает» `\` вместе со следующим символом
 * (например, `\n` в данных отрендерится как `n`).
 *
 * @example
 * escapeMarkdown('Анкета прервана.') // 'Анкета прервана\\.'
 * escapeMarkdown('5 + 5 = 10')      // '5 \\+ 5 \\= 10'
 * escapeMarkdown('C:\\temp')         // 'C:\\\\temp'
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/**
 * Безопасная конвертация Markdown → Telegram MarkdownV2.
 *
 * Проблема `convert()` из `markdown-to-telegram`: он НЕ экранирует
 * содержимое таблиц (handleTable берёт plain text через toString(),
 * таблицы официально unsupported).
 *
 * Решение: предобработка Markdown перед `convert()`.
 * `prepareMarkdown()` приводит неподдерживаемые элементы (таблицы)
 * к формату, который `convert()` умеет обрабатывать.
 * Никакой пост-обработки — `convert()` делает всё остальное.
 *
 * Алгоритм:
 * 1. `prepareMarkdown(markdown)` — приводит таблицы к текстовому виду
 * 2. `convert(prepared)` — преобразует разметку, экранирует символы
 */
export function safeConvert(markdown: string): string {
  return unescapeLineBreaks(convert(prepareMarkdown(markdown)));
}

// ═══════════════════════════════════════════════════════════════
// Предобработка Markdown
// ═══════════════════════════════════════════════════════════════

/** Функция-предобработчик Markdown перед передачей в convert() */
type MarkdownPreprocessor = (markdown: string) => string;

/**
 * Точка расширения для предобработки Markdown.
 *
 * Каждый обработчик в pipeline приводит неподдерживаемый `convert()`
 * элемент Markdown к виду, который `convert()` сможет обработать
 * без потери смысла и без нарушения экранирования.
 *
 * При обнаружении новой проблемы — добавляем обработчик в массив.
 */
function prepareMarkdown(markdown: string): string {
  const preprocessors: MarkdownPreprocessor[] = [fixTables];
  return preprocessors.reduce((md, fn) => fn(md), markdown);
}

// ═══════════════════════════════════════════════════════════════
// Обработчики
// ═══════════════════════════════════════════════════════════════

/**
 * Преобразует Markdown-таблицы в маркированный список.
 *
 * `convert()` не умеет экранировать содержимое ячеек таблиц
 * (handleTable выводит plain text из toString() без escapeSymbols).
 *
 * Этот обработчик заменяет таблицу на плоский текст:
 * ```
 * | A | B |             • A | B
 * |---|---|      →      • 1 | 2
 * | 1 | 2 |
 * | 3 | 4 |
 * ```
 *
 * Ячейки разделяются `|` — `convert()` экранирует его через escapeSymbols()
 * в текстовых узлах, в Telegram отобразится как `|`.
 *
 * Форматирование внутри ячеек (`` `code` ``, `**bold**`) сохраняется
 * и будет обработано `convert()`.
 *
 * Добавляет дополнительный `\n` после таблицы, чтобы следующий абзац
 * не «прилипал»: оригинальная таблица поглощает один из двух `\n\n`.
 */
function fixTables(markdown: string): string {
  return outsideCodeBlocks(markdown, convertTablesInText);
}

/** Применяет transform к тексту вне кодовых блоков (```...```) */
function outsideCodeBlocks(
  markdown: string,
  transform: (text: string) => string,
): string {
  const parts: string[] = [];
  let remaining = markdown;

  while (remaining.length > 0) {
    const codeBlock = remaining.match(/^```[\s\S]*?```/);
    if (codeBlock) {
      parts.push(codeBlock[0]);
      remaining = remaining.slice(codeBlock[0].length);
      continue;
    }

    const nextCode = remaining.search(/```/);
    const segment = nextCode === -1 ? remaining : remaining.slice(0, nextCode);

    parts.push(transform(segment));
    remaining = nextCode === -1 ? '' : remaining.slice(nextCode);
  }

  return parts.join('');
}

/** Находит и преобразует таблицы в текстовом сегменте (вне кодовых блоков) */
function convertTablesInText(text: string): string {
  // Строка заголовка | разделитель |---| | строки данных
  const tableRe = /^\|.+\|\n\|[-:| ]+\|\n(?:\|.+\|\n?)+/gm;

  return text.replace(tableRe, (table) => {
    const lines = table.trim().split('\n');
    const [header, , ...dataRows] = lines;

    const formatRow = (row: string): string => {
      // Ячейки разделены |, первая и последняя пустые (от split)
      const cells = row
        .split('|')
        .filter((c) => c !== '')
        .map((c) => c.trim());
      return `• ${cells.join(' | ')}`;
    };

    if (!header) return '';

    // + '\n' в конце — компенсирует поглощённый таблицей \n,
    // чтобы следующий абзац не прилипал
    return `${[formatRow(header), ...dataRows.map(formatRow)].join('\n')}\n`;
  });
}

// ═══════════════════════════════════════════════════════════════
// Постобработка: экранирование перевода строки
// ═══════════════════════════════════════════════════════════════

/**
 * Снимает экранирование перевода строки (`\` + LF → LF) вне код-сущностей.
 *
 * `convert()` рендерит markdown hard break (два пробела или `\` в конце
 * строки) как `\` перед переводом строки. Голый `\` перед переносом —
 * issue для валидатора (`assertMarkdownV2Safe` в проде ловит это
 * fail-fast, и экран не уходит пользователю). Обычный LF Telegram
 * рендерит тем же переносом, поэтому экранирование избыточно — снимаем.
 *
 * Код-сущности не трогаем: внутри pre и инлайн-кода `\\` — легитимно
 * экранированный слеш (например, перенос строки в bash-команде), снятие
 * экранирования исказило бы код. Сканируем линейно по тем же правилам,
 * что и валидатор (markdown-validator.ts), чтобы интерпретация текста
 * совпадала один в один.
 */
function unescapeLineBreaks(text: string): string {
  let result = '';
  let mode: 'outside' | 'inline' | 'pre' = 'outside';
  let i = 0;

  while (i < text.length) {
    const c = text.charAt(i);

    // ── Пре-блок: пары \\ копируем, ``` закрывает ──
    if (mode === 'pre') {
      if (c === '\\') {
        result += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '`' && text.startsWith('```', i)) {
        mode = 'outside';
        result += '```';
        i += 3;
        continue;
      }
      result += c;
      i += 1;
      continue;
    }

    // ── Инлайн-код: пары \\ копируем, ` закрывает ──
    if (mode === 'inline') {
      if (c === '\\') {
        result += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '`') mode = 'outside';
      result += c;
      i += 1;
      continue;
    }

    // ── Outside: единственная правка — `\` + LF → LF ──
    if (c === '\\' && text.charAt(i + 1) === '\n') {
      result += '\n';
      i += 2;
      continue;
    }
    if (c === '\\') {
      // Экранированный символ — копируем пару целиком
      result += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '`') {
      if (text.startsWith('```', i)) {
        mode = 'pre';
        result += '```';
        i += 3;
        continue;
      }
      mode = 'inline';
      result += c;
      i += 1;
      continue;
    }
    result += c;
    i += 1;
  }

  return result;
}
