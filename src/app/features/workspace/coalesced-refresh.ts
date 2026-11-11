/** The wait, in ms, for a burst of refresh triggers to end before one read runs. */
export const REFRESH_DEBOUNCE_MS = 300;

/**
 * A read that many triggers ask for: triggers that come close together become one read, run when they stop; only one runs
 * at a time, and one that comes while it runs makes it run once more after.
 */
export class CoalescedRefresh {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private again = false;

  /**
   * @param read what one refresh does, with the state it reads taken when it runs.
   * @param debounce the wait for a burst of triggers to end.
   * @param enabled whether a trigger counts now; one that does not is dropped.
   */
  constructor(
    private readonly read: () => Promise<void>,
    private readonly debounce: number,
    private readonly enabled: () => boolean = () => true,
  ) {}

  /** A trigger: the read runs once the triggers stop for the debounce. */
  schedule(): void {
    if (!this.enabled()) return;
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run(this.read);
    }, this.debounce);
  }

  /** Drops the wait for the end of a burst; a read already running is not stopped. */
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Runs `task` now, unless a read runs: then it is asked once more after. */
  async run(task: () => Promise<void>): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      await task();
    } finally {
      this.running = false;
    }
    if (this.again) {
      this.again = false;
      this.schedule();
    }
  }
}
