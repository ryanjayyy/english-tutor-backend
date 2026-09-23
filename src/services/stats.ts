import { ENGLISH_LEVELS, type EnglishLevel } from '../domain/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar day number for a timestamp, given the client's UTC offset in minutes (e.g. +480 for UTC+8). */
function localDay(date: Date, tzOffsetMinutes: number): number {
  return Math.floor((date.getTime() + tzOffsetMinutes * 60_000) / DAY_MS);
}

/**
 * Consecutive days with practice, ending today. If the learner hasn't practiced yet
 * today, a streak that ended yesterday still counts (it isn't broken until the day ends).
 */
export function computeStreak(practiceDates: Date[], now: Date, tzOffsetMinutes: number): number {
  const days = new Set(practiceDates.map((date) => localDay(date, tzOffsetMinutes)));
  const today = localDay(now, tzOffsetMinutes);
  let cursor = days.has(today) ? today : today - 1;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

export const MIN_SAMPLES_FOR_LEVEL = 3;

/** Median of recent per-message CEFR estimates; null until there's enough evidence. */
export function estimateLevel(recentEstimates: EnglishLevel[]): EnglishLevel | null {
  if (recentEstimates.length < MIN_SAMPLES_FOR_LEVEL) return null;
  const ranks = recentEstimates.map((level) => ENGLISH_LEVELS.indexOf(level)).sort((a, b) => a - b);
  const median = ranks[Math.floor((ranks.length - 1) / 2)]!;
  return ENGLISH_LEVELS[median]!;
}

export interface AnalyzedMessage {
  timestamp: Date;
  grammarMistakes: number;
}

/** Share of analyzed answers with no grammar mistakes, 0-100; null with no data. */
export function grammarAccuracy(messages: AnalyzedMessage[]): number | null {
  if (messages.length === 0) return null;
  const clean = messages.filter((message) => message.grammarMistakes === 0).length;
  return Math.round((clean / messages.length) * 100);
}

export interface WeeklyPoint {
  weekStart: string;
  answers: number;
  accuracy: number | null;
}

/** Weekly answer counts and accuracy for the last `weeks` weeks (oldest first). */
export function weeklyTrend(messages: AnalyzedMessage[], now: Date, tzOffsetMinutes: number, weeks = 8): WeeklyPoint[] {
  const today = localDay(now, tzOffsetMinutes);
  const firstDay = today - weeks * 7 + 1;
  const buckets: AnalyzedMessage[][] = Array.from({ length: weeks }, () => []);
  for (const message of messages) {
    const day = localDay(message.timestamp, tzOffsetMinutes);
    if (day < firstDay || day > today) continue;
    buckets[Math.floor((day - firstDay) / 7)]!.push(message);
  }
  return buckets.map((bucket, index) => ({
    weekStart: new Date((firstDay + index * 7) * DAY_MS).toISOString().slice(0, 10),
    answers: bucket.length,
    accuracy: grammarAccuracy(bucket),
  }));
}

export function countWords(text: string): number {
  const matches = text.trim().match(/[\p{L}\p{N}'-]+/gu);
  return matches ? matches.length : 0;
}
