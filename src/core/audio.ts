import {ActiveVoice, OutOfRangeNotice} from '../types/keyboard';
import {findNearestPianoSample, getActivePianoSamples, PianoSampleDefinition} from './pianoSamples';
import {getRuntimeAudioContextState, resumeAudioContextForPlayback} from './audioContextLifecycle';
import {isFrequencyOutOfRecommendedRange, isValidFrequencyValue} from './pitch';

type SoundSourceType = 'piano' | 'sawtooth' | 'square';

export type PianoSampleStatus = {
  kind: 'loading' | 'delayed' | 'error';
  message: string;
};

export type AudioContextStatus = {
  kind: 'starting' | 'ready' | 'failed';
  message: string;
};

const MAX_DECODED_PIANO_BYTES = 32 * 1024 * 1024;
const LOW_PRIORITY_FETCH_PAUSE_MS = 160;

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
  private decodedSampleCache: Map<string, AudioBuffer> = new Map();
  // The 45 compressed assets are ~3.13 MB in total; keep them separately
  // from the larger, bounded decoded PCM working set.
  private encodedSampleCache: Map<string, ArrayBuffer> = new Map();
  private pendingEncodedSamples: Map<string, Promise<ArrayBuffer>> = new Map();
  private visiblePianoSamples: Map<string, string[]> = new Map();
  private visiblePianoFrequenciesByGroup: Map<string, number[]> = new Map();
  private suspendedPreloadDecodeUnavailable = false;
  private preloadGeneration = 0;
  private preloadResumeDelayMs = 2000;
  private pendingVoices: Map<string, {address: number; cancelled: boolean}> = new Map();
  private voiceEpoch = 0;
  private preloadNeedsResume = false;
  private pianoPreloadPromise: Promise<void> | null = null;
  private pianoPreloadTimerId: number | null = null;
  private pendingVoiceCount = 0;
  private maxPolyphony = 32;
  private soundSource: SoundSourceType = 'piano';
  private savedMasterVolume = 0.8;
  private noteDecayMs = 0;
  private sustainLatch = false;
  private sustainMomentary = false;
  private onOutOfRangeCallback?: (notice: OutOfRangeNotice) => void;
  private onPianoSampleStatusCallback?: (status: PianoSampleStatus | null) => void;
  private onAudioContextStatusCallback?: (status: AudioContextStatus | null) => void;
  private audioContextStatus: AudioContextStatus | null = null;
  private lastNoticeTimeByAddress: Map<number, number> = new Map();

  private get isSustainActive(): boolean {
    return this.sustainLatch || this.sustainMomentary;
  }

  public async ensureAudioContext(): Promise<AudioContext> {
    if (this.ctx && getRuntimeAudioContextState(this.ctx) === 'running') {
      this.emitAudioContextStatus({kind: 'ready', message: '音声を再生できます。'});
      return this.ctx;
    }

    this.emitAudioContextStatus({kind: 'starting', message: '音声を準備中です。'});

    try {
      const context = this.createAudioContextWithoutResume();
      await resumeAudioContextForPlayback(context);
      this.suspendedPreloadDecodeUnavailable = false;

      this.emitAudioContextStatus({kind: 'ready', message: '音声を再生できます。'});
      return context;
    } catch (error) {
      this.emitAudioContextStatus({
        kind: 'failed',
        message: '音声を開始できませんでした。ブラウザの音声許可や出力先を確認して再試行してください。',
      });
      throw error;
    }
  }

  // Prewarming may create a suspended decoder, but it must never resume or
  // play audio outside the user's playback gesture (notably on iOS Safari).
  private createAudioContextWithoutResume(): AudioContext {
    if (!this.ctx || getRuntimeAudioContextState(this.ctx) === 'closed') {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext;
      this.ctx = new AudioCtxClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.savedMasterVolume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private sampleIdsForFrequencies(frequencies: number[]): string[] {
    return [...new Set(frequencies
      .filter((frequency) => Number.isFinite(frequency) && frequency > 0)
      .map((frequency) => findNearestPianoSample(frequency)?.id)
      .filter((id): id is string => Boolean(id)))];
  }

  private updateVisibleSampleIds(group: string, sampleIds: string[]): void {
    const previous = this.visiblePianoSamples.get(group) ?? [];
    if (previous.length === sampleIds.length && previous.every((id, index) => id === sampleIds[index])) return;
    if (sampleIds.length) this.visiblePianoSamples.set(group, sampleIds);
    else this.visiblePianoSamples.delete(group);
    this.preloadGeneration += 1;
    this.schedulePianoPreload(100);
  }

  public setVisiblePianoFrequencies(group: string, frequencies: number[]): void {
    if (frequencies.length) this.visiblePianoFrequenciesByGroup.set(group, frequencies);
    else this.visiblePianoFrequenciesByGroup.delete(group);
    this.updateVisibleSampleIds(group, this.sampleIdsForFrequencies(frequencies));
  }

  /** Called after a tuning/sample-reference update, before background work. */
  public refreshVisiblePianoSampleMappings(): void {
    for (const [group, frequencies] of this.visiblePianoFrequenciesByGroup) {
      this.updateVisibleSampleIds(group, this.sampleIdsForFrequencies(frequencies));
    }
  }

  public clearVisiblePianoFrequencies(group: string): void {
    this.visiblePianoFrequenciesByGroup.delete(group);
    this.updateVisibleSampleIds(group, []);
  }

  private visiblePianoSampleIds(): string[] {
    return [...new Set([...this.visiblePianoSamples.values()].flat())];
  }

  public async retryAudioContext(): Promise<AudioContext> {
    return this.ensureAudioContext();
  }

  public setSoundSource(source: SoundSourceType) {
    if (this.soundSource !== source) {
      this.allNotesOff();
      this.soundSource = source;
      if (source !== 'piano') {
        this.emitPianoSampleStatus(null);
      }
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

  public setPianoSampleStatusCallback(cb: (status: PianoSampleStatus | null) => void) {
    this.onPianoSampleStatusCallback = cb;
  }

  public setAudioContextStatusCallback(cb: (status: AudioContextStatus | null) => void) {
    this.onAudioContextStatusCallback = cb;
    cb(this.audioContextStatus);
  }

  public async noteOn(
    address: number,
    pitchId: number,
    frequency: number,
    velocity: number = 1.0,
    pointerId?: number | string,
    shouldStart?: () => boolean,
  ): Promise<string> {
    if (!isValidFrequencyValue(frequency)) {
      const timestamp = Date.now();
      this.onOutOfRangeCallback?.({
        id: `invalid_${address}_${timestamp}`,
        frequency,
        address,
        message: `再生できない周波数です (${Number.isFinite(frequency) ? `${frequency} Hz` : '非有限値'})。0より大きい有限値を指定してください。`,
        timestamp,
      });
      return `invalid_${address}_${pitchId}_${pointerId ?? 'mouse'}_${timestamp}`;
    }

    // A stop/source switch during the asynchronous AudioContext startup
    // invalidates the original key event, even before a voice ID exists.
    const admissionEpoch = this.voiceEpoch;
    const ctx = await this.ensureAudioContext();
    if (admissionEpoch !== this.voiceEpoch || shouldStart?.() === false) {
      return `cancelled_${address}_${pitchId}_${Date.now()}`;
    }
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
    voiceGain.connect(this.masterGain!);

    if (this.soundSource === 'piano') {
      this.schedulePianoPreload();
    }

    const pending = {address, cancelled: false};
    const epoch = this.voiceEpoch;
    this.pendingVoices.set(voiceId, pending);
    this.pendingVoiceCount += 1;
    // Return the voice identity before sample decoding, so an ordinary noteOff
    // can cancel a key that was released while its piano sample was loading.
    void (async () => {
      const sources = await this.createSourcesForVoice(
        ctx, frequency, voiceGain, now,
        () => pending.cancelled || epoch !== this.voiceEpoch || shouldStart?.() === false,
      );
      if (!sources) {
        try {
          voiceGain.disconnect();
        } catch {
          // ignore disconnect errors
        }
        return voiceId;
      }

      const {oscillators, sourceNodes, naturalDurationMs} = sources;
      if (pending.cancelled || epoch !== this.voiceEpoch || shouldStart?.() === false) {
        // The decoded source may already have been started. A key released
        // before registration must stop it rather than leave a hanging voice.
        for (const source of sourceNodes) {
          try { source.stop(ctx.currentTime); } catch { /* already stopped */ }
          source.disconnect();
        }
        for (const oscillator of oscillators) {
          try { oscillator.stop(ctx.currentTime); } catch { /* already stopped */ }
          oscillator.disconnect();
        }
        voiceGain.disconnect();
        return;
      }

      // An uncached sample may complete well after the original key event.
      // Start attack/decay from when the real audio is ready, not that event.
      const playbackStart = Math.max(now, ctx.currentTime);
      voiceGain.gain.setValueAtTime(0.0001, playbackStart);
      voiceGain.gain.linearRampToValueAtTime(velocityGain, playbackStart + attackTime);

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
        startTime: playbackStart,
      };

      if (this.noteDecayMs > 0) {
        const decayEndTime = playbackStart + attackTime + this.noteDecayMs / 1000;
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

    })().catch(() => {
      try {
        voiceGain.disconnect();
      } catch {
        // Audio node may already have been disconnected.
      }
      this.emitPianoSampleStatus({
        kind: 'error',
        message: 'ピアノ音源の再生準備に失敗しました。',
      });
    }).finally(() => {
      // Preserve the cancellation token until the source is either registered
      // or definitively discarded, never just until decoding completes.
      if (this.pendingVoices.delete(voiceId)) {
        this.pendingVoiceCount = Math.max(0, this.pendingVoiceCount - 1);
      }
    });
    return voiceId;
  }

  public noteOff(voiceId: string) {
    const pending = this.pendingVoices.get(voiceId);
    if (pending) pending.cancelled = true;
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
    for (const pending of this.pendingVoices.values()) {
      if (pending.address === address) pending.cancelled = true;
    }
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
    this.voiceEpoch += 1;
    for (const pending of this.pendingVoices.values()) pending.cancelled = true;
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

  public async preloadPianoSamples(): Promise<void> {
    if (this.soundSource !== 'piano' || this.visiblePianoSamples.size === 0) return;
    if (this.pianoPreloadPromise) return this.pianoPreloadPromise;
    this.pianoPreloadPromise = this.runPianoSamplePreload().finally(() => {
      this.pianoPreloadPromise = null;
      if (this.preloadNeedsResume) {
        this.preloadNeedsResume = false;
        this.schedulePianoPreload(this.preloadResumeDelayMs);
        this.preloadResumeDelayMs = 2000;
      }
    });
    return this.pianoPreloadPromise;
  }

  private schedulePianoPreload(delayMs: number = 2000) {
    if (this.pianoPreloadTimerId !== null) {
      window.clearTimeout(this.pianoPreloadTimerId);
      this.pianoPreloadTimerId = null;
    }
    if (this.soundSource !== 'piano' || this.visiblePianoSamples.size === 0) return;
    if (this.pianoPreloadPromise) {
      this.preloadNeedsResume = true;
      this.preloadResumeDelayMs = Math.min(this.preloadResumeDelayMs, delayMs);
      return;
    }
    this.pianoPreloadTimerId = window.setTimeout(() => {
      this.pianoPreloadTimerId = null;
      if (this.activeVoices.size > 0 || this.pendingVoiceCount > 0) {
        this.schedulePianoPreload(2000);
      } else {
        void this.preloadPianoSamples();
      }
    }, delayMs);
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
    // Pending sample voices consume admission slots just like active voices.
    // Keep the existing released/sustained/oldest-active stealing priority;
    // if *all* slots are pending, cancel and uncount the oldest pending token.
    while (this.activeVoices.size + this.pendingVoiceCount >= this.maxPolyphony) {
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
        continue;
      }

      const oldestPending = this.pendingVoices.entries().next().value;
      if (!oldestPending) break;
      const [pendingId, pending] = oldestPending;
      pending.cancelled = true;
      this.pendingVoices.delete(pendingId);
      this.pendingVoiceCount = Math.max(0, this.pendingVoiceCount - 1);
      // The async decode closure still holds the cancelled token, so it
      // cannot register a late source after its admission slot was reclaimed.
    }
  }

  private async createSourcesForVoice(
    ctx: AudioContext,
    frequency: number,
    gainNode: GainNode,
    now: number,
    isCancelled: () => boolean,
  ): Promise<(Pick<VoiceNode, 'oscillators' | 'sourceNodes'> & {naturalDurationMs?: number}) | null> {
    if (isCancelled()) return null;
    if (this.soundSource === 'piano') {
      return this.createPianoSources(ctx, frequency, gainNode, now, isCancelled);
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
    now: number,
    isCancelled: () => boolean,
  ): Promise<(Pick<VoiceNode, 'oscillators' | 'sourceNodes'> & {naturalDurationMs?: number}) | null> {
    const sample = findNearestPianoSample(frequency);
    if (!sample) {
      this.emitPianoSampleStatus({
        kind: 'error',
        message: 'この音高に対応するピアノ音源が見つかりません。',
      });
      return null;
    }

    // Always use the requested piano sample; do not replace its timbre with
    // an oscillator. Sample loads share one promise per unique sample ID.
    let buffer = this.decodedSampleCache.get(sample.id);
    if (!buffer) {
      this.emitPianoSampleStatus({
        kind: 'loading',
        message: 'ピアノ音源を準備中です。',
      });
      try {
        buffer = await this.loadPianoSampleBuffer(sample, ctx);
      } catch {
        // A pre-gesture decoder may fail on Safari; retry using the now
        // running playback context and the already-fetched compressed bytes.
        try {
          buffer = await this.loadPianoSampleBuffer(sample, ctx);
        } catch {
          this.emitPianoSampleStatus({
          kind: 'error',
          message: 'ピアノ音源を読み込めませんでした。通信状態を確認してください。',
          });
          return null;
        }
      }
    }
    // A released touch or layout/source switch must not sound after decoding.
    if (isCancelled()) return null;
    this.emitPianoSampleStatus(null);
    const startAt = Math.max(ctx.currentTime, now);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const playbackRate = frequency / (sample.referenceFrequency || sample.baseFrequency);
    source.playbackRate.setValueAtTime(playbackRate, startAt);
    source.connect(gainNode);
    source.start(startAt);

    return {
      oscillators: [],
      sourceNodes: [source],
      naturalDurationMs: Math.ceil((buffer.duration / Math.max(playbackRate, 0.001)) * 1000 + 50),
    };
  }

  private lastPianoSampleStatus: PianoSampleStatus | null = null;

  private emitPianoSampleStatus(status: PianoSampleStatus | null) {
    if (this.lastPianoSampleStatus?.kind === status?.kind &&
        this.lastPianoSampleStatus?.message === status?.message) {
      return;
    }
    this.lastPianoSampleStatus = status;
    this.onPianoSampleStatusCallback?.(status);
  }

  private emitAudioContextStatus(status: AudioContextStatus | null) {
    if (this.audioContextStatus?.kind === status?.kind &&
        this.audioContextStatus?.message === status?.message) {
      return;
    }
    this.audioContextStatus = status;
    this.onAudioContextStatusCallback?.(status);
  }

  private async runPianoSamplePreload(): Promise<void> {
    const preferred = this.visiblePianoSampleIds();
    const generation = this.preloadGeneration;
    if (!preferred.length) return;
    const samples = getActivePianoSamples();
    const byId = new Map(samples.map((sample) => [sample.id, sample]));
    let context: AudioContext | null = null;
    try {
      context = this.createAudioContextWithoutResume();
    } catch {
      // A browser can disallow constructing a context before a gesture.
      // Keep compressed bytes ready and let noteOn decode after resume.
      this.suspendedPreloadDecodeUnavailable = true;
    }
    for (const id of preferred) {
      if (this.soundSource !== 'piano') return;
      if (generation !== this.preloadGeneration) {
        this.preloadNeedsResume = true;
        return;
      }
      if (this.activeVoices.size > 0 || this.pendingVoiceCount > 0) {
        this.preloadNeedsResume = true;
        return;
      }
      if (!this.visiblePianoSampleIds().includes(id)) {
        this.preloadNeedsResume = true;
        return;
      }
      const sample = byId.get(id);
      if (!sample) continue;
      try {
        // Do not thrash the PCM cache on huge screens/two-row displays.
        const cacheBytes = this.decodedPianoCacheBytes();
        if (context && !this.suspendedPreloadDecodeUnavailable &&
            (this.decodedSampleCache.has(id) || cacheBytes < MAX_DECODED_PIANO_BYTES - 2 * 1024 * 1024)) {
          await this.loadPianoSampleBuffer(sample, context);
        } else {
          await this.fetchEncodedPianoSample(sample);
        }
      } catch {
        // Unsupported suspended-context decoding is recoverable on playback.
        // Encoded bytes remain cached, so a first gesture can retry.
        if (this.encodedSampleCache.has(id)) this.suspendedPreloadDecodeUnavailable = true;
      }
    }

    // Off-screen files are compact. Fetch only; never spend playback CPU time
    // decoding them ahead of currently visible keys.
    for (const sample of samples) {
      if (this.soundSource !== 'piano' || this.visiblePianoSamples.size === 0) return;
      if (generation !== this.preloadGeneration) {
        this.preloadNeedsResume = true;
        return;
      }
      if (this.visiblePianoSampleIds().includes(sample.id)) continue;
      if (this.activeVoices.size > 0 || this.pendingVoiceCount > 0) {
        this.preloadNeedsResume = true;
        return;
      }
      try {
        await this.fetchEncodedPianoSample(sample);
      } catch {
        // A failed background fetch is retried on demand.
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, LOW_PRIORITY_FETCH_PAUSE_MS));
    }
  }

  private decodedPianoCacheBytes(): number {
    let bytes = 0;
    for (const buffer of this.decodedSampleCache.values()) {
      bytes += buffer.length * buffer.numberOfChannels * 4;
    }
    return bytes;
  }

  private rememberDecodedPianoSample(id: string, buffer: AudioBuffer): void {
    const size = buffer.length * buffer.numberOfChannels * 4;
    if (size > MAX_DECODED_PIANO_BYTES) return;
    this.decodedSampleCache.delete(id);
    let bytes = this.decodedPianoCacheBytes();
    const preferred = new Set(this.visiblePianoSampleIds());
    while (bytes + size > MAX_DECODED_PIANO_BYTES && this.decodedSampleCache.size) {
      const victim = [...this.decodedSampleCache.keys()].find((key) => !preferred.has(key)) ??
        this.decodedSampleCache.keys().next().value;
      if (!victim) break;
      const previous = this.decodedSampleCache.get(victim)!;
      bytes -= previous.length * previous.numberOfChannels * 4;
      this.decodedSampleCache.delete(victim);
    }
    this.decodedSampleCache.set(id, buffer);
  }

  private async fetchEncodedPianoSample(sample: PianoSampleDefinition): Promise<ArrayBuffer> {
    const cached = this.encodedSampleCache.get(sample.id);
    if (cached) return cached;
    const pending = this.pendingEncodedSamples.get(sample.id);
    if (pending) return pending;
    const request = fetch(sample.url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to fetch sample: ${sample.fileName}`);
        const data = await response.arrayBuffer();
        this.encodedSampleCache.set(sample.id, data);
        return data;
      })
      .finally(() => this.pendingEncodedSamples.delete(sample.id));
    this.pendingEncodedSamples.set(sample.id, request);
    return request;
  }

  private async loadPianoSampleBuffer(sample: PianoSampleDefinition, context: AudioContext): Promise<AudioBuffer> {
    const cached = this.decodedSampleCache.get(sample.id);
    if (cached) {
      // Refresh the working-set order for actual playback.
      this.decodedSampleCache.delete(sample.id);
      this.decodedSampleCache.set(sample.id, cached);
      return cached;
    }
    let pending = this.sampleBufferCache.get(sample.id);
    if (!pending) {
      pending = this.fetchEncodedPianoSample(sample)
        .then((data) => context.decodeAudioData(data.slice(0)))
        .then((buffer) => {
          this.rememberDecodedPianoSample(sample.id, buffer);
          return buffer;
        })
        .finally(() => {
          // Resolved promises also retain their AudioBuffers. Do not let the
          // in-flight table defeat the bounded decoded-cache eviction policy.
          this.sampleBufferCache.delete(sample.id);
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

    // Exclude releasing voices from polyphony accounting immediately.
    // Their nodes still complete the scheduled release and disconnect later.
    this.activeVoices.delete(voiceId);
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
