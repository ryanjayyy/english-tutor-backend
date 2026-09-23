import { describe, expect, it } from 'vitest';

import { computeStreak, countWords, estimateLevel, grammarAccuracy, weeklyTrend } from '../src/services/stats.js';

const at = (iso: string) => new Date(iso);

describe('computeStreak', () => {
  const now = at('2026-09-23T10:00:00Z');

  it('counts consecutive days ending today', () => {
    const dates = [at('2026-09-23T08:00:00Z'), at('2026-09-22T08:00:00Z'), at('2026-09-21T23:00:00Z')];
    expect(computeStreak(dates, now, 0)).toBe(3);
  });

  it('keeps a streak that ended yesterday alive', () => {
    expect(computeStreak([at('2026-09-22T08:00:00Z'), at('2026-09-21T08:00:00Z')], now, 0)).toBe(2);
  });

  it('breaks on a missed day', () => {
    expect(computeStreak([at('2026-09-23T08:00:00Z'), at('2026-09-21T08:00:00Z')], now, 0)).toBe(1);
  });

  it("uses the learner's timezone", () => {
    // 2026-09-22T20:00Z is already Sep 23 in UTC+8.
    expect(computeStreak([at('2026-09-22T20:00:00Z')], now, 480)).toBe(1);
    // Sep 25 09:00 local: the last practice (Sep 23 local) is two days ago.
    expect(computeStreak([at('2026-09-22T20:00:00Z')], at('2026-09-25T01:00:00Z'), 480)).toBe(0);
  });

  it('is zero without practice', () => {
    expect(computeStreak([], now, 0)).toBe(0);
  });
});

describe('estimateLevel', () => {
  it('needs a few samples', () => {
    expect(estimateLevel(['B1', 'B1'])).toBeNull();
  });

  it('returns the median level', () => {
    expect(estimateLevel(['A2', 'B1', 'C1'])).toBe('B1');
    expect(estimateLevel(['A1', 'A2', 'B2', 'C1'])).toBe('A2');
  });
});

describe('grammarAccuracy', () => {
  it('is the share of answers without grammar mistakes', () => {
    const messages = [0, 0, 2, 1].map((grammarMistakes) => ({ timestamp: new Date(), grammarMistakes }));
    expect(grammarAccuracy(messages)).toBe(50);
  });

  it('is null without data', () => {
    expect(grammarAccuracy([])).toBeNull();
  });
});

describe('weeklyTrend', () => {
  it('buckets the last weeks oldest first', () => {
    const now = at('2026-09-23T12:00:00Z');
    const trend = weeklyTrend(
      [
        { timestamp: at('2026-09-23T09:00:00Z'), grammarMistakes: 0 },
        { timestamp: at('2026-09-20T09:00:00Z'), grammarMistakes: 1 },
        { timestamp: at('2026-09-10T09:00:00Z'), grammarMistakes: 0 },
        { timestamp: at('2025-01-01T09:00:00Z'), grammarMistakes: 0 },
      ],
      now,
      0,
      4,
    );
    expect(trend).toHaveLength(4);
    expect(trend.at(-1)).toMatchObject({ answers: 2, accuracy: 50 });
    expect(trend.reduce((sum, week) => sum + week.answers, 0)).toBe(3);
  });
});

describe('countWords', () => {
  it('counts words including contractions', () => {
    expect(countWords("I don't go mall yesterday.")).toBe(5);
    expect(countWords('   ')).toBe(0);
  });
});
