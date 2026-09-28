type ScheduleTimer = (callback: () => void, delayMs: number) => number;
type ClearTimer = (timerId: number) => void;
type SaveValue<T> = (value: T) => Promise<void> | void;
type SaveErrorHandler = (error: unknown) => void;
type SaveSuccessHandler = () => void;

export class DebouncedSettingsSaver<T> {
  private timerId: number | null = null;
  private latest: T | null = null;
  private pending = false;
  private readonly inFlightRevisions = new Set<number>();
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
    this.flushPending(false);
  }

  flushForLifecycle(): void {
    this.flushPending(true);
  }

  hasPending(): boolean {
    return this.pending;
  }

  private flushPending(allowConcurrent: boolean): void {
    if (!this.pending) return;

    if (this.timerId !== null) {
      this.clearTimer(this.timerId);
      this.timerId = null;
    }

    this.commitPending(allowConcurrent);
  }

  private commitPending(allowConcurrent = false): void {
    if (!this.pending || this.latest === null) return;

    const revision = this.revision;
    if (this.inFlightRevisions.has(revision)) return;
    if (!allowConcurrent && this.inFlightRevisions.size > 0) return;

    const value = this.latest;
    this.inFlightRevisions.add(revision);

    let saveResult: Promise<void> | void;
    try {
      saveResult = this.save(value);
    } catch (error) {
      this.finishFailure(error, revision);
      return;
    }

    void Promise.resolve(saveResult).then(
      () => this.finishSuccess(revision),
      (error) => this.finishFailure(error, revision),
    );
  }

  private finishSuccess(revision: number): void {
    this.inFlightRevisions.delete(revision);
    if (this.revision === revision) {
      this.pending = false;
      this.onSaved();
      return;
    }

    if (!this.pending && !this.inFlightRevisions.has(this.revision)) {
      this.pending = true;
      this.commitPending();
      return;
    }

    this.commitLatestAfterStaleSettlement();
  }

  private finishFailure(error: unknown, revision: number): void {
    this.inFlightRevisions.delete(revision);
    if (this.revision === revision) {
      this.pending = true;
      this.onError(error);
      return;
    }

    this.commitLatestAfterStaleSettlement();
  }

  private commitLatestAfterStaleSettlement(): void {
    if (!this.pending || this.inFlightRevisions.has(this.revision)) return;
    this.commitPending();
  }
}
