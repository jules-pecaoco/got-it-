type Pending = { start: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const busy = () =>
  Object.assign(new Error('The preview is busy. Retry shortly.'), { code: 'WEB_CAPACITY', status: 503 });

// A checkpoint goes ahead of waiting browser requests, but never races an active write.
export class WorkspaceQueue {
  private pending: Pending[] = [];
  private active = false;
  private closed = false;
  private idleWaiters: (() => void)[] = [];
  constructor(
    private capacity = 16,
    private waitMs = 10000,
  ) {}
  run<T>(action: () => Promise<T>, checkpoint = false): Promise<T> {
    if (this.closed || this.pending.length >= this.capacity) return Promise.reject(busy());
    return new Promise<T>((resolve, reject) => {
      const entry: Pending = {
        reject,
        timer: setTimeout(() => {
          this.pending = this.pending.filter((item) => item !== entry);
          reject(busy());
        }, this.waitMs),
        start: () => {
          clearTimeout(entry.timer);
          this.active = true;
          void Promise.resolve()
            .then(action)
            .then(resolve, reject)
            .finally(() => {
              this.active = false;
              this.pump();
            });
        },
      };
      if (checkpoint) this.pending.unshift(entry);
      else this.pending.push(entry);
      this.pump();
    });
  }
  private pump() {
    if (this.active) return;
    const next = this.pending.shift();
    if (next) next.start();
    else this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }
  async close() {
    this.closed = true;
    for (const entry of this.pending.splice(0)) {
      clearTimeout(entry.timer);
      entry.reject(busy());
    }
    if (this.active) await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }
  stats() {
    return { active: this.active, queued: this.pending.length };
  }
}
