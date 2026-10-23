export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} was not found.`);
export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'invalid_request', message, fields);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
