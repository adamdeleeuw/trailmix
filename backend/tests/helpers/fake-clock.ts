import type { PollerDeps } from '../../src/services/live-feeds';

/** A fake clock with timers that run when the test moves time forward, awaiting each callback. */
export class FakeClock {
  time = 1_794_900_000_000;
  private timers: { at: number; callback: () => Promise<void>; id: number }[] = [];
  private nextId = 0;

  deps(fetchFeed: PollerDeps['fetchFeed']): PollerDeps {
    return {
      fetchFeed,
      now: () => this.time,
      setTimer: (callback, ms) => {
        this.nextId += 1;
        this.timers.push({ at: this.time + ms, callback, id: this.nextId });
        return this.nextId;
      },
      clearTimer: (id) => { this.timers = this.timers.filter((timer) => timer.id !== id); },
    };
  }

  get pending(): number {
    return this.timers.length;
  }

  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.time = due.at;
      await due.callback();
    }
    this.time = end;
  }
}
