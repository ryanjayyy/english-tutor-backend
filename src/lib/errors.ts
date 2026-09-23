export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    /** The underlying provider error, kept for server logs (never sent to clients). */
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') => new AppError(400, code, message);
export const unauthorized = (message = 'Please sign in again.', code = 'UNAUTHORIZED') => new AppError(401, code, message);
export const notFound = (message = 'Not found.', code = 'NOT_FOUND') => new AppError(404, code, message);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);
export const upstream = (message: string, code = 'UPSTREAM_ERROR', cause?: unknown) =>
  new AppError(502, code, message, { cause });
export const timeout = (message: string, code = 'UPSTREAM_TIMEOUT', cause?: unknown) =>
  new AppError(504, code, message, { cause });
