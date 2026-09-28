type ScheduleTimer = (callback: () => void, delayMs: number) => number;
type ClearTimer = (timerId: number) => void;
type SaveValue<T> = (value: T) => Promise<void> | void;

export class DebouncedSettingsSaver<T> {
  private timerId: number | null = null;
  private latest: T | null = null;
  private pending = false;
  private inFlight = false;
  private generation = 0;

  constructor(
    private readonly save: SaveValue<T>,
    private readonly scheduleTimer: ScheduleTimer,
    private readonly clearTimer: ClearTimer,
    private readonly delayMs: number,
  ) {}

  schedule(value: T): void {
    this.latest = value;
    this.pending = true;
    this.generation += 1;

    if (this.timerId !== null) {
      this.clearTimer(this.timerId);
    }

    this.timerId = this.scheduleTimer(() => {
      this.timerId = null;
      this.commitPending();
    }, this.delayMs);
  }

  flush(): void {
    if (!this.pending) {
      return;
    }

    if (this.timerId !== null) {
      this.clearTimer(this.timerId);
      this.timerId = null;
    }

    this.commitPending();
  }

  private commitPending(): void {
    if (this.inFlight || !this.pending || this.latest === null) {
      return;
    }

    const value = this.latest;
    const generation = this.generation;
    this.pending = false;
    this.inFlight = true;

    let saveResult: Promise<void> | void;
    try {
      saveResult = this.save(value);
    } catch {
      this.inFlight = false;
      this.pending = true;
      return;
    }

    Promise.resolve(saveResult).then(
      () => {
        this.inFlight = false;
        if (generation === this.generation) {
          this.latest = null;
        }
        if (this.pending) {
          this.commitPending();
        }
      },
      () => {
        this.inFlight = false;
        this.pending = true;
      },
    );
  }
}
