import type { z } from 'zod';

import { badRequest } from './errors.js';

export function parseInput<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.');
    throw badRequest(field ? `${field}: ${issue!.message}` : (issue?.message ?? 'Invalid request.'), 'VALIDATION_ERROR');
  }
  return result.data;
}
