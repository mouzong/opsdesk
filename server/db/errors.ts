/** Startup/configuration failure with a message that is safe to print (never contains credentials or URLs). */
export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}
