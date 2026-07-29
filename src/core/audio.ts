import {ActiveVoice, OutOfRangeNotice} from '../types/keyboard';
import {findNearestPianoSample, PianoSampleDefinition} from './pianoSamples';
import {isFrequencyOutOfRecommendedRange} from './pitch';

type SoundSourceType = 'piano' | 'sawtooth' | 'square';

interface VoiceNode {
  voiceId: string;
  address: number;
  pitchId: number;
  frequency: number;
  gainNode: GainNode;
  oscillators: OscillatorNode[];
  sourceNodes: AudioBufferSourceNode[];
  isSustained: boolean;
  isReleased: boolean;
  startTime: number;
  decayTimeoutId?: number;
  naturalEndTimeoutId?: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeVoices: Map<string, VoiceNode> = new Map();
  private sampleBufferCache: Map<string, Promise<AudioBuffer>> = new Map();
  private maxPolyphony = 64;
  private soundSource: SoundSourceType = 'piano';
  private savedMasterVolume = 0.8;
  private noteDecayMs = 0;
  private sustainLatch = false;
  private sustainMomentary = false;
  private onOutOfRangeCallback?: (notice: OutOfRangeNotice) => void;
  private lastNoticeTimeByAddress: Map<number, number> = new Map();

  private get isSustainActive(): boolean {
    return this.sustainLatch || this.sustainMomentary;
  }

  public async ensureAudioContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
      this.ctx = new AudioCtxClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.savedMasterVolume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    return this.ctx;
  }

  public setSoundSource(source: SoundSourceType) {
    if (this.soundSource !== source) {
      this.allNotesOff();
      this.soundSource = source;
    }
  }

  public setMasterVolume(vol: number) {
    const clamped = Math.max(0, Math.min(1, vol));
    this.savedMasterVolume = clamped;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.01);
    }
  }

  public setNoteDecayMs(ms: number) {
    this.noteDecayMs = Math.max(0, Math.floor(ms));
  }

  public setSustainLatch(active: boolean) {
    this.sustainLatch = active;
    this.checkSustainRelease();
  }

  public setSustainMomentary(active: boolean) {
    this.sustainMomentary = active;
    this.checkSustainRelease();
  }

  public setSustain(active: boolean) {
    this.setSustainLatch(active);
  }

  public setOutOfRangeNoticeCallback(cb: (notice: OutOfRangeNotice) => void) {
    this.onOutOfRangeCallback = cb;
  }

  public async noteOn(
    address: number,
    pitchId: number,
    frequency: number,
    velocity: number = 1.0,
    pointerId?: number | string
  ): Promise<string> {
    const ctx = await this.ensureAudioContext();
    const now = ctx.currentTime;

    if (isFrequencyOutOfRecommendedRange(frequency) && this.onOutOfRangeCallback) {
      const lastTime = this.lastNoticeTimeByAddress.get(address) || 0;
      if (Date.now() - lastTime > 1000) {
        this.lastNoticeTimeByAddress.set(address, Date.now());
        this.onOutOfRangeCallback({
          id: `${address}_${Date.now()}`,
          frequency,
          address,
          message: `推奨音域外の音高です (${frequency.toFixed(1)} Hz)。再生が不安定になる場合があります。`,
          timestamp: Date.now(),
        });
      }
    }

    this.trimVoicesIfNeeded(now);

    const voiceId = `${address}_${pitchId}_${pointerId ?? 'mouse'}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 5)}`;
    const voiceGain = ctx.createGain();
    const attackTime = this.soundSource === 'piano' ? 0.008 : 0.01;
    const velocityGain = Math.max(0.1, Math.min(1.0, velocity)) * 0.6;

    voiceGain.gain.setValueAtTime(0.0001, now);
    voiceGain.gain.linearRampToValueAtTime(velocityGain, now + attackTime);
    voiceGain.connect(this.masterGain!);

    const {oscillators, sourceNodes, naturalDurationMs} = await this.createSourcesForVoice(ctx, frequency, voiceGain, now);

    const voiceNode: VoiceNode = {
      voiceId,
      address,
      pitchId,
      frequency,
      gainNode: voiceGain,
      oscillators,
      sourceNodes,
      isSustained: this.isSustainActive,
      isReleased: false,
      startTime: now,
    };

    if (this.noteDecayMs > 0) {
      const decayEndTime = now + attackTime + this.noteDecayMs / 1000;
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, decayEndTime);
      voiceNode.decayTimeoutId = window.setTimeout(() => {
        if (!this.activeVoices.has(voiceId) || !this.ctx) {
          return;
        }
        this.stopVoiceNode(voiceId, this.ctx.currentTime, 0.01);
      }, Math.ceil(attackTime * 1000 + this.noteDecayMs + 50));
    }

    if (naturalDurationMs !== undefined) {
      voiceNode.naturalEndTimeoutId = window.setTimeout(() => {
        if (!this.activeVoices.has(voiceId) || !this.ctx) {
          return;
        }
        this.stopVoiceNode(voiceId, this.ctx.currentTime, 0.01);
      }, naturalDurationMs);
    }

    this.activeVoices.set(voiceId, voiceNode);
    return voiceId;
  }

  public noteOff(voiceId: string) {
    const voice = this.activeVoices.get(voiceId);
    if (!voice || !this.ctx) {
      return;
    }

    voice.isReleased = true;
    if (this.isSustainActive) {
      voice.isSustained = true;
      return;
    }

    this.stopVoiceNode(voiceId, this.ctx.currentTime);
  }

  public noteOffByAddress(address: number) {
    if (!this.ctx) {
      return;
    }

    const now = this.ctx.currentTime;
    for (const [voiceId, voice] of this.activeVoices.entries()) {
      if (voice.address !== address) {
        continue;
      }

      voice.isReleased = true;
      if (this.isSustainActive) {
        voice.isSustained = true;
      } else {
        this.stopVoiceNode(voiceId, now);
      }
    }
  }

  public allNotesOff() {
    if (!this.ctx) {
      return;
    }

    const now = this.ctx.currentTime;
    for (const voiceId of Array.from(this.activeVoices.keys())) {
      this.stopVoiceNode(voiceId, now, 0.01);
    }
  }

  public getActiveVoices(): ActiveVoice[] {
    return Array.from(this.activeVoices.values()).map((voice) => ({
      id: voice.voiceId,
      address: voice.address,
      pitchId: voice.pitchId,
      frequency: voice.frequency,
      velocity: 1.0,
      startTime: voice.startTime,
    }));
  }

  private checkSustainRelease() {
    if (!this.isSustainActive && this.ctx) {
      const now = this.ctx.currentTime;
      for (const [voiceId, voice] of this.activeVoices.entries()) {
        if (voice.isReleased && voice.isSustained) {
          this.stopVoiceNode(voiceId, now);
        }
      }
    }
  }

  private trimVoicesIfNeeded(now: number) {
    if (this.activeVoices.size < this.maxPolyphony) {
      return;
    }

    let candidateKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, voice] of this.activeVoices.entries()) {
      if (voice.isReleased && voice.isSustained && voice.startTime < oldestTime) {
        oldestTime = voice.startTime;
        candidateKey = key;
      }
    }

    if (!candidateKey) {
      oldestTime = Infinity;
      for (const [key, voice] of this.activeVoices.entries()) {
        if (voice.isReleased && voice.startTime < oldestTime) {
          oldestTime = voice.startTime;
          candidateKey = key;
        }
      }
    }

    if (!candidateKey) {
      oldestTime = Infinity;
      for (const [key, voice] of this.activeVoices.entries()) {
        if (voice.startTime < oldestTime) {
          oldestTime = voice.startTime;
          candidateKey = key;
        }
      }
    }

    if (candidateKey) {
      this.stopVoiceNode(candidateKey, now, 0.01);
    }
  }

  private async createSourcesForVoice(
    ctx: AudioContext,
    frequency: number,
    gainNode: GainNode,
    now: number
  ): Promise<Pick<VoiceNode, 'oscillators' | 'sourceNodes'> & {naturalDurationMs?: number}> {
    if (this.soundSource === 'piano') {
      return this.createPianoSources(ctx, frequency, gainNode, now);
    }

    const osc = ctx.createOscillator();
    osc.type = this.soundSource;
    osc.frequency.setValueAtTime(frequency, now);
    osc.connect(gainNode);
    osc.start(now);

    return {
      oscillators: [osc],
      sourceNodes: [],
    };
  }

  private async createPianoSources(
    ctx: AudioContext,
    frequency: number,
    gainNode: GainNode,
    now: number
  ): Promise<Pick<VoiceNode, 'oscillators' | 'sourceNodes'> & {naturalDurationMs?: number}> {
    const sample = findNearestPianoSample(frequency);
    if (sample) {
      try {
        const buffer = await this.loadPianoSampleBuffer(sample);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const playbackRate = frequency / (sample.referenceFrequency || sample.baseFrequency);
        source.playbackRate.setValueAtTime(playbackRate, now);
        source.connect(gainNode);
        source.start(now);

        return {
          oscillators: [],
          sourceNodes: [source],
          naturalDurationMs: Math.ceil((buffer.duration / Math.max(playbackRate, 0.001)) * 1000 + 50),
        };
      } catch {
        // Fallback to synthetic voice below.
      }
    }

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(frequency, now);

    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(frequency * 2, now);

    const osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(frequency * 3, now);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    osc3.connect(gainNode);
    osc1.start(now);
    osc2.start(now);
    osc3.start(now);

    return {
      oscillators: [osc1, osc2, osc3],
      sourceNodes: [],
    };
  }

  private async loadPianoSampleBuffer(sample: PianoSampleDefinition): Promise<AudioBuffer> {
    const ctx = await this.ensureAudioContext();
    let pending = this.sampleBufferCache.get(sample.id);

    if (!pending) {
      pending = fetch(sample.url)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch sample: ${sample.fileName}`);
          }
          const data = await response.arrayBuffer();
          return ctx.decodeAudioData(data.slice(0));
        })
        .catch((error) => {
          this.sampleBufferCache.delete(sample.id);
          throw error;
        });
      this.sampleBufferCache.set(sample.id, pending);
    }

    return pending;
  }

  private stopVoiceNode(voiceId: string, now: number, releaseTime: number = 0.15) {
    const voice = this.activeVoices.get(voiceId);
    if (!voice) {
      return;
    }

    if (voice.decayTimeoutId !== undefined) {
      window.clearTimeout(voice.decayTimeoutId);
      voice.decayTimeoutId = undefined;
    }

    if (voice.naturalEndTimeoutId !== undefined) {
      window.clearTimeout(voice.naturalEndTimeoutId);
      voice.naturalEndTimeoutId = undefined;
    }

    const gain = voice.gainNode;
    const stopAt = now + releaseTime + 0.02;

    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);

    for (const source of voice.sourceNodes) {
      try {
        source.stop(stopAt);
      } catch {
        // ignore duplicate stops
      }
    }

    for (const osc of voice.oscillators) {
      try {
        osc.stop(stopAt);
      } catch {
        // ignore duplicate stops
      }
    }

    window.setTimeout(() => {
      for (const source of voice.sourceNodes) {
        try {
          source.disconnect();
        } catch {
          // ignore disconnect errors
        }
      }

      for (const osc of voice.oscillators) {
        try {
          osc.disconnect();
        } catch {
          // ignore disconnect errors
        }
      }

      try {
        gain.disconnect();
      } catch {
        // ignore disconnect errors
      }

      this.activeVoices.delete(voiceId);
    }, Math.ceil((releaseTime + 0.05) * 1000));
  }
}

export const globalAudioEngine = new AudioEngine();
