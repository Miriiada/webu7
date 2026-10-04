import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import bigInt from 'big-integer';
import { Api, type TelegramClient } from 'teleproto';
import { readCatalog } from '../server/content.js';
import { parseStep, completionEvidence } from '../server/progress.js';
import { TelegramBridge, type BotMessage } from '../server/telegram.js';
import { Store } from '../server/db.js';
import { seal } from '../server/security.js';
import type { Config } from '../server/config.js';
const c = readCatalog();
const lesson = c.lessons.find(l => l.id === '01a09652-bf63-4ac1-b96d-7749abc1e543')!;
function body(index = 4) { return `📖 Поток: Алгоритмика - 7\n📁 Проект: TDD и функции сравнения строк (первая реализация)\n📚 Урок: «${lesson.title}»\n🔢 p3-l2\n📊 [████████░░] ${index}/5\n📝 Шаг ${index + 1} из 5: ${c.steps.find(s => s.id === lesson.stepIds[index])!.title}`; }
const msg = (text: string, id = 1): BotMessage => ({ text, id, date: 100, buttons: [] });
test('Прогресс различает одноимённые уроки по проекту и не приписывает предыдущий модуль', () => {
  const parsed = parseStep(msg(body()), c)!;
  assert.equal(parsed.lesson.id, lesson.id);
  assert.deepEqual(parsed.completed, lesson.stepIds.slice(0, 4));
  assert.equal(completionEvidence([msg(body())], c).size, 4);
  assert.equal(parseStep(msg(body().replace('TDD и функции сравнения строк (первая реализация)', 'Неизвестный проект')), c), null);
  assert.equal(parseStep(msg(body().replace('из 5', 'из 6')), c), null);
});
test('Выданный шаг не выполнен; переход подтверждает последний шаг', () => {
  const evidence = completionEvidence([msg(body()), msg(`🎉 Урок «${lesson.title}» завершён!`, 2)], c);
  assert.equal(evidence.size, 5);
  assert.equal(completionEvidence([msg(`🎉 Урок «${lesson.title}» завершён!`, 2)], c).size, 0);
});
test('Просмотр первого шага завершённого урока с 5/5 восстанавливает все пять отметок', () => {
  const parsed = parseStep(msg(body(0).replace('0/5', '5/5')), c)!;
  assert.deepEqual(parsed.completed, lesson.stepIds);
});
test('Названия с вложенными кавычками и отчёт Мой прогресс восстанавливаются однозначно', () => {
  const module = c.modules.find(m => m.title === 'Алгоритмика')!;
  const project = module.projects!.find(p => p.title === 'Код-ревью: правила и первый полный цикл')!;
  const nested = c.lessons.find(l => project.lessonIds.includes(l.id) && l.title.includes('ДЗ: статья'))!;
  const text = `📖 Поток: Алгоритмика - 7\n📁 Проект: ${project.title}\n📚 Урок: «${nested.title}»\n📊 [██████████] 2/2\n📝 Шаг 1 из 2: ${c.steps.find(s => s.id === nested.stepIds[0])!.title}`;
  assert.deepEqual(parseStep(msg(text), c)!.completed, nested.stepIds);
  const report = `📊 Мой прогресс — Алгоритмика - 7\n▶️ Проект 2: ${project.title} — [████░░░░░░] 13/23\n    ✅ Как работает код-ревью — [██████████] 3/3\n    ✅ Правила ревью — [██████████] 3/3\n    🔒 Доработка по ревью — [░░░░░░░░░░] 0/3`;
  const evidence = completionEvidence([msg(report)], c);
  assert.equal(evidence.size, 6);
});
function fixture(mode: 'step' | 'lesson' | 'timeout' | 'menu' = 'step') {
  const store = new Store(':memory:'), key = randomBytes(32);
  for (const id of ['alice', 'bob']) store.db.prepare('INSERT INTO users(id,email,name,password,telegram,telegram_id,created) VALUES(?,?,?,?,?,?,?)').run(id, `${id}@example.test`, id, 'unused', seal('fake', key, `telegram:${id}`), id, Date.now());
  const config: Config = { key, production: false, origin: 'http://localhost:4173', host: '127.0.0.1', port: 4173, dbPath: ':memory:', apiId: 1, apiHash: 'a'.repeat(32), bot: 'u7_school_bot', botId: '100' };
  const peer = new Api.User({ id: bigInt(100), bot: true });
  const message = (text: string, id: number, button?: string) => new Api.Message({ id, date: 100, message: text, peerId: new Api.PeerUser({ userId: peer.id }), replyMarkup: button ? new Api.ReplyInlineMarkup({ rows: [new Api.KeyboardInlineButtonRow({ buttons: [new Api.KeyboardInlineButton({ text: button, type: new Api.InlineButtonTypeCallback({ data: Buffer.from(String(id)) }) })] })] }) : undefined });
  let list = [message(body(mode === 'lesson' ? 4 : 0), 1, '✅ Выполнено')], calls = 0;
  if (mode === 'menu') list = [message('Главное меню', 2, 'Моя учёба'), message(body(0), 1)];
  const fake = { connect: async () => {}, destroy: async () => {}, getEntity: async () => peer,
    getMessages: async (_peer: unknown, args: { ids?: number[] }) => args.ids ? list.filter(m => args.ids!.includes(m.id)) : list,
    invoke: async (r: unknown) => { assert(r instanceof Api.messages.GetBotCallbackAnswer); calls++;
      if (mode === 'timeout') throw new Error('Response lost');
      if (mode === 'lesson' && calls === 1) list = [message(`🎉 Урок «${lesson.title}» завершён!`, 2, '▶️ Начать следующий урок'), message(body(4), 1)];
      else list = [message(body(1), 3, '✅ Выполнено'), message(body(0), 1)];
      return { message: '' }; },
  } as unknown as TelegramClient;
  const bridge = new TelegramBridge(config, store, () => fake);
  return { bridge, store, calls: () => calls, close: async () => { await bridge.close(); store.close(); } };
}
test('Чтение прогресса не нажимает кнопки; чужой шаг отклоняется; ответ бота подтверждает выполнение', async () => {
  const f = fixture();
  try {
    const initial = await f.bridge.learning('alice', 'browser');
    assert.equal(initial.current?.stepId, lesson.stepIds[0]); assert.equal(f.calls(), 0);
    await assert.rejects(() => f.bridge.completeLearningStep('alice', 'browser', lesson.stepIds[3]), { code: 'STALE_BUTTON' });
    assert.equal(f.calls(), 0);
    const after = await f.bridge.completeLearningStep('alice', 'browser', lesson.stepIds[0]);
    assert(after.completedStepIds.includes(lesson.stepIds[0])); assert.equal(after.current?.stepId, lesson.stepIds[1]); assert.equal(f.calls(), 1);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM learning_steps WHERE user_id=?').get('bob')!.n, 0);
    await assert.rejects(() => f.bridge.completeLearningStep('alice', 'browser', lesson.stepIds[0]), { code: 'STALE_BUTTON' }); assert.equal(f.calls(), 1);
  } finally { await f.close(); }
});


test('Последний шаг подтверждается переходом; кнопка следующего урока нажимается один раз', async () => {
  const f = fixture('lesson');
  try {
    const result = await f.bridge.completeLearningStep('alice', 'browser', lesson.stepIds[4]);
    assert(result.completedLessonIds.includes(lesson.id)); assert.equal(f.calls(), 2);
  } finally { await f.close(); }
});
test('Меню не скрывает текущий урок; шаг без кнопки доступен для чтения, но не для выполнения', async () => {
  const f = fixture('menu');
  try {
    const result = await f.bridge.learning('alice', 'browser');
    assert.equal(result.current?.lessonId, lesson.id);
    assert.equal(result.current?.stepId, lesson.stepIds[0]);
    assert.equal(result.current?.ticket, undefined);
    await assert.rejects(() => f.bridge.completeLearningStep('alice', 'browser', lesson.stepIds[0]), { code: 'STALE_BUTTON' });
    assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});

test('Потерянный ответ не ставит галочку и блокирует повтор команды', async () => {
  const f = fixture('timeout');
  try {
    await assert.rejects(() => f.bridge.completeLearningStep('alice', 'browser', lesson.stepIds[0]), { code: 'RESULT_UNKNOWN' });
    const result = await f.bridge.learning('alice', 'browser');
    assert(!result.completedStepIds.includes(lesson.stepIds[0]));
    await assert.rejects(() => f.bridge.completeLearningStep('alice', 'browser', lesson.stepIds[0]), { code: 'ALREADY_SENT' });
    assert.equal(f.calls(), 1);
  } finally { await f.close(); }
});
