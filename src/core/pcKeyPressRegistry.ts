export type ActivePcKeyPress = {
  voiceId: string;
  address: number;
};

type PcKeyPressState = {
  token: number;
  address: number;
  voiceId?: string;
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
    if (!current || current.token !== token) {
      this.stopVoice(voiceId);
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
    }
    this.presses.delete(key);
  }

  cancelAll(): void {
    for (const current of this.presses.values()) {
      if (current.voiceId) {
        this.stopVoice(current.voiceId);
      }
    }
    this.presses.clear();
  }

  getActive(key: string): ActivePcKeyPress | undefined {
    const current = this.presses.get(key);
    if (!current?.voiceId) {
      return undefined;
    }
    return {voiceId: current.voiceId, address: current.address};
  }
}
