import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

import {
  EnglishAnalysisSchema,
  type ConversationTurn,
  type EnglishAnalysis,
  type PracticeMode,
  type TutorContext,
} from '../../domain/types.js';
import { AppError, timeout, upstream } from '../../lib/errors.js';
import {
  MAX_HISTORY_TURNS,
  TUTOR_SYSTEM_PROMPT,
  buildAnalysisRequest,
  buildOpeningRequest,
  describeContext,
} from './prompt.js';
import type { EnglishTutorService, OpeningMessage } from './types.js';

const OpeningSchema = z.object({
  message: z.string().describe('A brief greeting followed by the first question.'),
});

const REQUEST_TIMEOUT_MS = 60_000;

interface GeminiTutorOptions {
  apiKey: string;
  model: string;
}

/** Google Gemini implementation (usable on Gemini's free tier). Same prompt and JSON shape as the Claude tutor. */
export class GeminiEnglishTutor implements EnglishTutorService {
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor({ apiKey, model }: GeminiTutorOptions) {
    this.client = new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
    this.model = model;
  }

  startConversation(context: TutorContext): Promise<OpeningMessage> {
    return this.request(OpeningSchema, context, buildOpeningRequest());
  }

  analyzeResponse(
    userMessage: string,
    conversationHistory: ConversationTurn[],
    context: TutorContext & { mode: PracticeMode },
  ): Promise<EnglishAnalysis> {
    const history = conversationHistory.slice(-MAX_HISTORY_TURNS);
    return this.request(EnglishAnalysisSchema, context, buildAnalysisRequest(userMessage, history, context.mode));
  }

  private async request<T extends z.ZodType>(schema: T, context: TutorContext, input: string): Promise<z.infer<T>> {
    let text: string | undefined;
    try {
      const interaction = await this.client.interactions.create({
        model: this.model,
        input,
        system_instruction: `${TUTOR_SYSTEM_PROMPT}\n\n${describeContext(context)}`,
        response_format: { type: 'text', mime_type: 'application/json', schema: z.toJSONSchema(schema, { io: 'input' }) },
        // Conversation turns are routine: light thinking keeps replies fast.
        generation_config: { thinking_level: 'low', max_output_tokens: 8000 },
        // Don't keep conversations on Google's side after answering.
        store: false,
      });
      if (interaction.status && interaction.status !== 'completed') {
        throw upstream('The tutor returned an incomplete answer. Please try again.', 'AI_BAD_RESPONSE', `status ${interaction.status}`);
      }
      text = interaction.output_text;
    } catch (error) {
      throw mapGeminiError(error);
    }

    if (!text) throw upstream('The tutor returned an empty answer. Please try again.', 'AI_BAD_RESPONSE');
    try {
      return schema.parse(JSON.parse(text)) as z.infer<T>;
    } catch (error) {
      throw upstream('The tutor returned an unexpected answer. Please try again.', 'AI_BAD_RESPONSE', error);
    }
  }
}

function mapGeminiError(error: unknown): Error {
  if (error instanceof AppError) return error;
  const status = (error as { status?: number }).status;
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError' || /timed? ?out/i.test(String((error as Error)?.message))) {
    return timeout('The tutor took too long to answer. Please try again.', 'AI_TIMEOUT', error);
  }
  if (status === 429) {
    // On the free tier this usually means the per-minute or daily quota is used up.
    return new AppError(503, 'AI_BUSY', 'The tutor has reached its usage limit for now. Please try again later.', { cause: error });
  }
  if (typeof status === 'number') {
    return upstream('The tutor service had a problem. Please try again.', 'AI_ERROR', error);
  }
  return upstream('Could not reach the tutor service. Please try again.', 'AI_UNREACHABLE', error);
}
