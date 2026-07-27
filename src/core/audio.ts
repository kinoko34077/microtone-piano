/**
 * Web Audio API 音声エンジン & 64声ボイスマネージャー
 */

import { ActiveVoice, OutOfRangeNotice } from '../types/keyboard';
import { isFrequencyOutOfRecommendedRange } from './pitch';

type SoundSourceType = 'piano' | 'sawtooth' | 'square';

interface VoiceNode {
  voiceId: string;
  address: number;
  pitchId: number;
  frequency: number;
  gainNode: GainNode;
  oscillators: OscillatorNode[];
  sourceNodes?: AudioBufferSourceNode[];
  isSustained: boolean;
  isReleased: boolean;
  startTime: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeVoices: Map<string, VoiceNode> = new Map();
  private maxPolyphony: number = 64;
  private soundSource: SoundSourceType = 'piano';
  private savedMasterVolume: number = 0.8;
  private sustainLatch: boolean = false;
  private sustainMomentary: boolean = false;
  private onOutOfRangeCallback?: (notice: OutOfRangeNotice) => void;

  // 重複通知抑止用タイマーマップ
  private lastNoticeTimeByAddress: Map<number, number> = new Map();

  constructor() {
    // AudioContextはユーザー操作(最初のキー押下等)で遅延初期化する
  }

  private get isSustainActive(): boolean {
    return this.sustainLatch || this.sustainMomentary;
  }

  /**
   * AudioContext の初期化または再開 (iOS等のブラウザ制約対策)
   */
  public async ensureAudioContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

  /**
   * 音源種別の設定
   */
  public setSoundSource(source: SoundSourceType) {
    if (this.soundSource !== source) {
      this.allNotesOff();
      this.soundSource = source;
    }
  }

  /**
   * マスター音量の設定 (0.0 ~ 1.0)
   */
  public setMasterVolume(vol: number) {
    const clamped = Math.max(0, Math.min(1, vol));
    this.savedMasterVolume = clamped;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.01);
    }
  }

  /**
   * サステイン(ホールド)ラッチ状態の変更
   */
  public setSustainLatch(active: boolean) {
    this.sustainLatch = active;
    this.checkSustainRelease();
  }

  /**
   * サステイン(ホールド)モーメンタリ状態の変更 (Spaceキー等)
   */
  public setSustainMomentary(active: boolean) {
    this.sustainMomentary = active;
    this.checkSustainRelease();
  }

  /**
   * サステイン旧互換用メソッド
   */
  public setSustain(active: boolean) {
    this.setSustainLatch(active);
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

  /**
   * 範囲外音高通知コールバックの設定
   */
  public setOutOfRangeNoticeCallback(cb: (notice: OutOfRangeNotice) => void) {
    this.onOutOfRangeCallback = cb;
  }

  /**
   * 音声再生 (Note On)
   */
  public async noteOn(
    address: number,
    pitchId: number,
    frequency: number,
    velocity: number = 1.0,
    pointerId?: number | string
  ): Promise<string> {
    const ctx = await this.ensureAudioContext();
    const now = ctx.currentTime;

    // 範囲外通知の判定 (重複通知を1秒以内に同じキーで出さない)
    if (isFrequencyOutOfRecommendedRange(frequency) && this.onOutOfRangeCallback) {
      const lastTime = this.lastNoticeTimeByAddress.get(address) || 0;
      if (Date.now() - lastTime > 1000) {
        this.lastNoticeTimeByAddress.set(address, Date.now());
        this.onOutOfRangeCallback({
          id: `${address}_${Date.now()}`,
          frequency,
          address,
          message: `発音推奨範囲外 (${frequency.toFixed(1)} Hz) ですが、そのまま試行します。`,
          timestamp: Date.now(),
        });
      }
    }

    // 64声超過時の厳格なドロップ優先順位
    // 1. 離鍵済みかつサステイン保持音
    // 2. 離鍵済み音
    // 3. 最古の押下中音
    if (this.activeVoices.size >= this.maxPolyphony) {
      let candidateKey: string | null = null;
      let oldestTime = Infinity;

      // Priority 1: Released & Sustained
      for (const [key, v] of this.activeVoices.entries()) {
        if (v.isReleased && v.isSustained && v.startTime < oldestTime) {
          oldestTime = v.startTime;
          candidateKey = key;
        }
      }

      // Priority 2: Released
      if (!candidateKey) {
        oldestTime = Infinity;
        for (const [key, v] of this.activeVoices.entries()) {
          if (v.isReleased && v.startTime < oldestTime) {
            oldestTime = v.startTime;
            candidateKey = key;
          }
        }
      }

      // Priority 3: Oldest active
      if (!candidateKey) {
        oldestTime = Infinity;
        for (const [key, v] of this.activeVoices.entries()) {
          if (v.startTime < oldestTime) {
            oldestTime = v.startTime;
            candidateKey = key;
          }
        }
      }

      if (candidateKey) {
        this.stopVoiceNode(candidateKey, now, 0.01);
      }
    }

    const voiceId = `${address}_${pitchId}_${pointerId ?? 'mouse'}_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
    const voiceGain = ctx.createGain();
    const velClamped = Math.max(0.1, Math.min(1.0, velocity));

    voiceGain.gain.setValueAtTime(0, now);
    const attackTime = this.soundSource === 'piano' ? 0.008 : 0.01;
    voiceGain.gain.linearRampToValueAtTime(velClamped * 0.6, now + attackTime);

    voiceGain.connect(this.masterGain!);

    const oscillators: OscillatorNode[] = [];

    if (this.soundSource === 'piano') {
      // ピアノ風音色: 基音 + 2倍音 + 3倍音 + 低音サステインアタック
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(frequency, now);

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(frequency * 2, now);

      const osc3 = ctx.createOscillator();
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(frequency * 3, now);

      osc1.connect(voiceGain);
      osc2.connect(voiceGain);
      osc3.connect(voiceGain);

      osc1.start(now);
      osc2.start(now);
      osc3.start(now);

      oscillators.push(osc1, osc2, osc3);
    } else {
      // Sawtooth / Square (クリック音防止アタック/リリース)
      const osc = ctx.createOscillator();
      osc.type = this.soundSource;
      osc.frequency.setValueAtTime(frequency, now);

      osc.connect(voiceGain);
      osc.start(now);
      oscillators.push(osc);
    }

    const voiceNode: VoiceNode = {
      voiceId,
      address,
      pitchId,
      frequency,
      gainNode: voiceGain,
      oscillators,
      isSustained: this.isSustainActive,
      isReleased: false,
      startTime: now,
    };

    this.activeVoices.set(voiceId, voiceNode);
    return voiceId;
  }

  /**
   * 音声停止 (Note Off)
   */
  public noteOff(voiceId: string) {
    const voice = this.activeVoices.get(voiceId);
    if (!voice || !this.ctx) return;

    voice.isReleased = true;

    if (this.isSustainActive) {
      voice.isSustained = true;
      return;
    }

    this.stopVoiceNode(voiceId, this.ctx.currentTime);
  }

  /**
   * 特定アドレスに関する全ボイスの解放 (同じ鍵のNote Off)
   */
  public noteOffByAddress(address: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const [key, v] of this.activeVoices.entries()) {
      if (v.address === address) {
        v.isReleased = true;
        if (!this.isSustainActive) {
          this.stopVoiceNode(key, now);
        } else {
          v.isSustained = true;
        }
      }
    }
  }

  /**
   * 全ボイスの強制停止 (All Notes Off)
   */
  public allNotesOff() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const key of Array.from(this.activeVoices.keys())) {
      this.stopVoiceNode(key, now, 0.01);
    }
  }

  /**
   * 内部用: ボイスノードのフェードアウトと破棄
   */
  private stopVoiceNode(voiceId: string, now: number, releaseTime: number = 0.15) {
    const voice = this.activeVoices.get(voiceId);
    if (!voice || !this.ctx) return;

    const gain = voice.gainNode;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);

    setTimeout(() => {
      for (const osc of voice.oscillators) {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // すでに停止済みの場合
        }
      }
      try {
        gain.disconnect();
      } catch {
        // すでに切断済みの場合
      }
      this.activeVoices.delete(voiceId);
    }, releaseTime * 1000 + 50);
  }

  /**
   * 現在アクティブなボイス一覧を取得
   */
  public getActiveVoices(): ActiveVoice[] {
    const list: ActiveVoice[] = [];
    for (const v of this.activeVoices.values()) {
      list.push({
        id: v.voiceId,
        address: v.address,
        pitchId: v.pitchId,
        frequency: v.frequency,
        velocity: 1.0,
        startTime: v.startTime,
      });
    }
    return list;
  }
}

// シングルトンインスタンスの作成
export const globalAudioEngine = new AudioEngine();
