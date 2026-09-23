import type { EnglishAnalysis, PronunciationResult } from '../domain/types.js';
import type { Message, PracticeSession, User } from '../generated/prisma/client.js';

export function toUserDto(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isGuest: user.isGuest,
    englishLevel: user.englishLevel,
    levelIsEstimated: user.levelIsEstimated,
    onboardingDone: user.onboardingDone,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toMessageDto(message: Message) {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    mode: message.mode ?? undefined,
    timestamp: message.timestamp.toISOString(),
    analysis: (message.analysis as EnglishAnalysis | null) ?? undefined,
    pronunciation: (message.pronunciation as PronunciationResult | null) ?? undefined,
  };
}

export function toSessionDto(session: PracticeSession & { messages?: Message[] }) {
  return {
    id: session.id,
    topic: session.topic,
    topicId: session.topicId ?? undefined,
    focus: session.focus ?? undefined,
    mode: session.mode,
    level: session.level,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString(),
    messages: session.messages?.map(toMessageDto),
  };
}
