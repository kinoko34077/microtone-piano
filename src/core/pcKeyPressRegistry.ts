export type ActivePcKeyPress = {
  voiceId: string;
  address: number;
};

type PcKeyPressState = {
  token: number;
  address: number;
  voiceId?: string;
  cancelled?: boolean;
};

export class PcKeyPressRegistry {
  private readonly presses = new Map<string, PcKeyPressState>();
  private nextToken = 0;

  constructor(private readonly stopVoice: (voiceId: string) => void) {}

  begin(key: string, address: number): {token: number; address: number} {
    const token = ++this.nextToken;
    this.presses.set(key, {token, address});
    return {token, address};
  }

  has(key: string): boolean {
    return this.presses.has(key);
  }

  resolve(key: string, token: number, voiceId: string): boolean {
    const current = this.presses.get(key);
    if (!current || current.token !== token || current.cancelled) {
      this.stopVoice(voiceId);
      if (current?.token === token) {
        this.presses.delete(key);
      }
      return false;
    }

    this.presses.set(key, {...current, voiceId});
    return true;
  }

  release(key: string): void {
    const current = this.presses.get(key);
    if (!current) {
      return;
    }
    if (current.voiceId) {
      this.stopVoice(current.voiceId);
      this.presses.delete(key);
      return;
    }
    this.presses.set(key, {...current, cancelled: true});
  }

  abort(key: string, token: number): void {
    const current = this.presses.get(key);
    if (current?.token === token) {
      this.presses.delete(key);
    }
  }

  cancelAll(): void {
    for (const [key, current] of this.presses) {
      if (current.voiceId) {
        this.stopVoice(current.voiceId);
        this.presses.delete(key);
      } else {
        this.presses.set(key, {...current, cancelled: true});
      }
    }
  }

  getActive(key: string): ActivePcKeyPress | undefined {
    const current = this.presses.get(key);
    if (!current?.voiceId || current.cancelled) {
      return undefined;
    }
    return {voiceId: current.voiceId, address: current.address};
  }
}
