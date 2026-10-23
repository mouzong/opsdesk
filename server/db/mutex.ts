/** Minimal FIFO async mutex. Write transactions on PostgreSQL/MySQL run one at a time per OpsDesk process. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => fn());
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }
}
