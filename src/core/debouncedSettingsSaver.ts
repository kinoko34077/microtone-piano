type ScheduleTimer = (callback: () => void, delayMs: number) => number;
type ClearTimer = (timerId: number) => void;
type SaveValue<T> = (value: T) => Promise<void> | void;

export class DebouncedSettingsSaver<T> {
  private timerId: number | null = null;
  private latest: T | null = null;
  private pending = false;

  constructor(
    private readonly save: SaveValue<T>,
    private readonly scheduleTimer: ScheduleTimer,
    private readonly clearTimer: ClearTimer,
    private readonly delayMs: number,
  ) {}

  schedule(value: T): void {
    this.latest = value;
    this.pending = true;

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
    if (!this.pending || this.latest === null) {
      return;
    }

    const value = this.latest;
    this.pending = false;
    void this.save(value);
  }
}
