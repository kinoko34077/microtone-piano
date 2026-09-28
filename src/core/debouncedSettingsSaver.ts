type ScheduleTimer = (callback: () => void, delayMs: number) => number;
type ClearTimer = (timerId: number) => void;
type SaveValue<T> = (value: T) => Promise<void> | void;
type SaveErrorHandler = (error: unknown) => void;
type SaveSuccessHandler = () => void;

export class DebouncedSettingsSaver<T> {
  private timerId: number | null = null;
  private latest: T | null = null;
  private pending = false;
  private inFlight = false;
  private revision = 0;

  constructor(
    private readonly save: SaveValue<T>,
    private readonly scheduleTimer: ScheduleTimer,
    private readonly clearTimer: ClearTimer,
    private readonly delayMs: number,
    private readonly onError: SaveErrorHandler = () => {},
    private readonly onSaved: SaveSuccessHandler = () => {},
  ) {}

  schedule(value: T): void {
    this.latest = value;
    this.pending = true;
    this.revision += 1;

    if (this.timerId !== null) {
      this.clearTimer(this.timerId);
    }

    this.timerId = this.scheduleTimer(() => {
      this.timerId = null;
      this.commitPending();
    }, this.delayMs);
  }

  flush(): void {
    if (!this.pending) return;

    if (this.timerId !== null) {
      this.clearTimer(this.timerId);
      this.timerId = null;
    }

    this.commitPending();
  }

  hasPending(): boolean {
    return this.pending;
  }

  private commitPending(): void {
    if (!this.pending || this.latest === null || this.inFlight) return;

    const value = this.latest;
    const revision = this.revision;
    this.inFlight = true;

    let saveResult: Promise<void> | void;
    try {
      saveResult = this.save(value);
    } catch (error) {
      this.finishFailure(error, revision);
      return;
    }

    void Promise.resolve(saveResult).then(
      () => {
        this.inFlight = false;
        if (this.revision === revision) {
          this.pending = false;
        }
        this.onSaved();
        if (this.pending && this.revision !== revision) {
          this.commitPending();
        }
      },
      (error) => this.finishFailure(error, revision),
    );
  }

  private finishFailure(error: unknown, revision: number): void {
    this.inFlight = false;
    this.pending = true;
    this.onError(error);
    if (this.revision !== revision) {
      this.commitPending();
    }
  }
}
