/**
 * 音高計算・周波数算出モジュール
 */

import { PitchDefinition, PitchLabelMode, TuningPreset } from '../types/keyboard';

// 12EDO音名マッピング (標準C4=baseStep 0 = C4)
const NOTE_NAMES_12 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DOREMI_NAMES_12 = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];

/**
 * 音高定義および調律プリセットから周波数 (Hz) を算出
 */
export function resolvePitch(
  pitchId: number | undefined,
  preset: TuningPreset
): { pitchDef: PitchDefinition | null; octaveShift: number } {
  if (pitchId === undefined || pitchId === -1) {
    return { pitchDef: null, octaveShift: 0 };
  }
  const N = preset.pitches.length;
  if (N === 0) {
    return { pitchDef: null, octaveShift: 0 };
  }
  
  const pitchIndex = ((pitchId % N) + N) % N;
  const baseOctaveShift = Math.floor(pitchId / N);
  const pitchDef = preset.pitches[pitchIndex];
  
  return { pitchDef, octaveShift: baseOctaveShift };
}

export function calculateFrequency(
  pitch: PitchDefinition,
  preset: TuningPreset,
  octaveShift: number = 0
): number {
  const baseFreq = preset.baseFrequency || 261.63; // C4 default
  const periodCents = preset.periodCents || 1200.0;
  // 周期の周波数倍率 (1200 cent -> 2.0)
  const periodRatio = Math.pow(2, periodCents / 1200.0);

  let freq = baseFreq;

  switch (pitch.type) {
    case 'edo': {
      const edo = pitch.edo || 12;
      const step = pitch.step ?? 0;
      const baseStep = preset.baseStep ?? 0;
      const stepDiff = step - baseStep;
      freq = baseFreq * Math.pow(periodRatio, stepDiff / edo);
      break;
    }

    case 'cents': {
      const cents = pitch.cents ?? 0;
      freq = baseFreq * Math.pow(2, cents / 1200.0);
      break;
    }

    case 'ratio': {
      const num = pitch.numerator || 1;
      const den = pitch.denominator || 1;
      freq = baseFreq * (num / den);
      break;
    }

    case 'frequency': {
      freq = pitch.frequency || baseFreq;
      break;
    }

    default:
      freq = baseFreq;
  }

  // オクターブ/周期シフト適用
  if (octaveShift !== 0) {
    freq *= Math.pow(periodRatio, octaveShift);
  }

  return freq;
}

/**
 * 周波数が可聴推奨域(20Hz ~ 20000Hz)の外にあるか判定
 */
export function isFrequencyOutOfRecommendedRange(freq: number): boolean {
  return freq < 20.0 || freq > 20000.0;
}

/**
 * 周波数表示用文字列の整形
 */
export function formatFrequency(freq: number): string {
  if (freq >= 1000) {
    return `${(freq / 1000).toFixed(3)} kHz`;
  }
  return `${freq.toFixed(2)} Hz`;
}

/**
 * 音高の文字表現を取得 (例: "31EDO Step +5", "700.0 cent", "3/2 (1.5)", "440.0 Hz")
 */
export function getPitchLabel(pitch: PitchDefinition): string {
  switch (pitch.type) {
    case 'edo':
      return `${pitch.edo || 12}EDO ステップ ${pitch.step ?? 0}`;
    case 'cents':
      return `${pitch.cents ?? 0} cent`;
    case 'ratio': {
      const r = (pitch.numerator || 1) / (pitch.denominator || 1);
      return `${pitch.numerator || 1}/${pitch.denominator || 1} (${r.toFixed(3)})`;
    }
    case 'frequency':
      return `${pitch.frequency ?? 440} Hz`;
    default:
      return pitch.name || '不明';
  }
}

/**
 * モード (音名 C4 / ドレミ / ステップ / 周波数 / なし) に合わせたラベルを取得
 */
export function getFormattedPitchLabel(
  pitch: PitchDefinition,
  preset: TuningPreset,
  mode: PitchLabelMode = 'note',
  octaveShift: number = 0
): string {
  if (mode === 'none') return '';

  if (mode === 'freq') {
    const freq = calculateFrequency(pitch, preset, octaveShift);
    return formatFrequency(freq);
  }

  const pitchCount = preset.pitches?.length || 12;
  const edo = pitch.edo || pitchCount;
  const rawStep = pitch.step ?? 0;
  const shiftedStep = rawStep + octaveShift * edo;

  if (mode === 'step') {
    return `S${shiftedStep}`;
  }

  const N = pitchCount > 0 ? pitchCount : 12;
  const oct = 4 + Math.floor(shiftedStep / N);
  const mod = ((shiftedStep % N) + N) % N;

  if (mode === 'note') {
    if (preset.noteNames && preset.noteNames.length > 0) {
      const noteName = preset.noteNames[mod % preset.noteNames.length];
      return `${noteName}${oct}`;
    }
    if (edo === 12) {
      return `${NOTE_NAMES_12[mod % 12]}${oct}`;
    }
  }

  if (mode === 'doremi') {
    if (preset.doremiNames && preset.doremiNames.length > 0) {
      const doremiName = preset.doremiNames[mod % preset.doremiNames.length];
      return `${doremiName}${oct}`;
    }
    if (edo === 12) {
      return `${DOREMI_NAMES_12[mod % 12]}${oct}`;
    }
  }

  // その他カスタム名がある場合
  if (pitch.name) {
    if (octaveShift === 0) return pitch.name;
    return `${pitch.name} (${octaveShift > 0 ? '+' : ''}${octaveShift}oct)`;
  }

  return `S${shiftedStep}`;
}
