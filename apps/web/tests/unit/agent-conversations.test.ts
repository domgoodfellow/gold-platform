import { describe, expect, it } from 'vitest';
import { formatRecent } from '@/features/agent/recent-time';
import {
  CONTEXT_MAX_ANSWER_CHARS,
  CONTEXT_MAX_CHARS,
  CONTEXT_MAX_TURNS,
  TITLE_MAX,
  boundPriorTurns,
  deriveConversationTitle,
} from '@/lib/domain/assistant/questions';

describe('deriveConversationTitle — the first question, shortened, with no model call', () => {
  it('keeps a short question as written, whitespace collapsed', () => {
    expect(deriveConversationTitle('  What is   late\n today? ')).toBe('What is late today?');
  });

  it('cuts a long one to the display length and says it was cut', () => {
    const title = deriveConversationTitle('word '.repeat(100));
    expect(Array.from(title)).toHaveLength(TITLE_MAX);
    expect(title.endsWith('…')).toBe(true);
  });

  it('never splits a character in half', () => {
    const title = deriveConversationTitle('🚚'.repeat(200));
    expect(Array.from(title)).toHaveLength(TITLE_MAX);
    expect(title).toBe(`${'🚚'.repeat(TITLE_MAX - 1)}…`);
  });

  it('leaves a question exactly at the limit alone', () => {
    const exact = 'x'.repeat(TITLE_MAX);
    expect(deriveConversationTitle(exact)).toBe(exact);
  });
});

describe('boundPriorTurns — what a conversation may carry into a request', () => {
  const turn = (n: number, answer = `a${n}`) => ({ question: `q${n}`, answer });

  it('passes a short conversation through unchanged and in order', () => {
    expect(boundPriorTurns([turn(1), turn(2)])).toEqual([turn(1), turn(2)]);
  });

  it('keeps only the newest turns when there are too many', () => {
    const turns = Array.from({ length: CONTEXT_MAX_TURNS + 6 }, (_, n) => turn(n));
    const kept = boundPriorTurns(turns);
    expect(kept).toHaveLength(CONTEXT_MAX_TURNS);
    expect(kept.at(-1)).toEqual(turns.at(-1));
    expect(kept[0]).toEqual(turns[6]);
  });

  it('shortens one enormous answer rather than dropping the conversation', () => {
    const kept = boundPriorTurns([turn(1, 'y'.repeat(50_000))]);
    expect(kept).toHaveLength(1);
    expect(kept[0].answer).toHaveLength(CONTEXT_MAX_ANSWER_CHARS);
  });

  it('stays within the size budget and keeps one unbroken run ending at the latest turn', () => {
    const big = 'z'.repeat(CONTEXT_MAX_ANSWER_CHARS);
    const turns = Array.from({ length: CONTEXT_MAX_TURNS }, (_, n) => ({ question: `q${n}`, answer: big }));
    const kept = boundPriorTurns(turns);
    expect(kept.reduce((sum, t) => sum + t.question.length + t.answer.length, 0)).toBeLessThanOrEqual(
      CONTEXT_MAX_CHARS,
    );
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(CONTEXT_MAX_TURNS);
    expect(kept.at(-1)?.question).toBe(`q${CONTEXT_MAX_TURNS - 1}`);
  });
});

describe('formatRecent — the time History shows beside a title', () => {
  const now = new Date('2026-09-20T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('says just now for the last minute', () => {
    expect(formatRecent(ago(20_000), now)).toBe('Just now');
  });

  it('counts minutes, hours and days', () => {
    expect(formatRecent(ago(5 * 60_000), now)).toBe('5 minutes ago');
    expect(formatRecent(ago(3 * 3_600_000), now)).toBe('3 hours ago');
    expect(formatRecent(ago(86_400_000), now)).toBe('yesterday');
    expect(formatRecent(ago(3 * 86_400_000), now)).toBe('3 days ago');
  });

  it('gives a plain date once it is a week old', () => {
    expect(formatRecent(ago(10 * 86_400_000), now)).toMatch(/Sep.*10.*2026|10.*Sep.*2026/);
  });
});
