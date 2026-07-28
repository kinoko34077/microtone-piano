import {PitchDefinition, PitchLabelMode, TuningPreset} from '../types/keyboard';

export const PITCH_REFERENCE_STRIDE = 256;

const NOTE_NAMES_12 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DOREMI_NAMES_12 = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];

export function encodePitchReference(basePitchId: number, octaveShift: number = 0): number {
  return Math.trunc(basePitchId) + Math.trunc(octaveShift) * PITCH_REFERENCE_STRIDE;
}

export function decodePitchReference(pitchRef: number): {basePitchId: number; octaveShift: number} {
  const octaveShift = Math.floor(pitchRef / PITCH_REFERENCE_STRIDE);
  const basePitchId = ((pitchRef % PITCH_REFERENCE_STRIDE) + PITCH_REFERENCE_STRIDE) % PITCH_REFERENCE_STRIDE;
  return {basePitchId, octaveShift};
}

export function resolvePitch(
  pitchRef: number | undefined,
  preset: TuningPreset,
): {pitchDef: PitchDefinition | null; octaveShift: number} {
  if (pitchRef === undefined || pitchRef === -1) {
    return {pitchDef: null, octaveShift: 0};
  }

  const exactMatch = preset.pitches.find((pitch) => pitch.id === pitchRef);
  if (exactMatch) {
    return {pitchDef: exactMatch, octaveShift: 0};
  }

  const {basePitchId, octaveShift} = decodePitchReference(pitchRef);
  const baseMatch = preset.pitches.find((pitch) => pitch.id === basePitchId);
  if (baseMatch) {
    return {pitchDef: baseMatch, octaveShift};
  }

  const pitchCount = preset.pitches.length;
  if (pitchCount === 0) {
    return {pitchDef: null, octaveShift: 0};
  }

  const legacyIndex = ((pitchRef % pitchCount) + pitchCount) % pitchCount;
  return {
    pitchDef: preset.pitches[legacyIndex] ?? null,
    octaveShift: Math.floor(pitchRef / pitchCount),
  };
}

export function calculateFrequency(
  pitch: PitchDefinition,
  preset: TuningPreset,
  octaveShift: number = 0,
): number {
  const baseFreq = preset.baseFrequency || 261.63;
  const periodCents = preset.periodCents || 1200.0;
  const periodRatio = Math.pow(2, periodCents / 1200.0);

  let freq = baseFreq;

  switch (pitch.type) {
    case 'edo': {
      const edo = pitch.edo || 12;
      const step = pitch.step ?? 0;
      const baseStep = preset.baseStep ?? 0;
      freq = baseFreq * Math.pow(periodRatio, (step - baseStep) / edo);
      break;
    }
    case 'cents':
      freq = baseFreq * Math.pow(2, (pitch.cents ?? 0) / 1200.0);
      break;
    case 'ratio':
      freq = baseFreq * ((pitch.numerator || 1) / (pitch.denominator || 1));
      break;
    case 'frequency':
      freq = pitch.frequency || baseFreq;
      break;
    default:
      freq = baseFreq;
      break;
  }

  if (octaveShift !== 0) {
    freq *= Math.pow(periodRatio, octaveShift);
  }

  return freq;
}

export function isFrequencyOutOfRecommendedRange(freq: number): boolean {
  return freq < 20.0 || freq > 20000.0;
}

export function formatFrequency(freq: number): string {
  if (freq >= 1000) {
    return `${(freq / 1000).toFixed(3)} kHz`;
  }
  return `${freq.toFixed(2)} Hz`;
}

export function getPitchLabel(pitch: PitchDefinition): string {
  switch (pitch.type) {
    case 'edo':
      return `${pitch.edo || 12}EDO Step ${pitch.step ?? 0}`;
    case 'cents':
      return `${pitch.cents ?? 0} cent`;
    case 'ratio': {
      const ratio = (pitch.numerator || 1) / (pitch.denominator || 1);
      return `${pitch.numerator || 1}/${pitch.denominator || 1} (${ratio.toFixed(3)})`;
    }
    case 'frequency':
      return `${pitch.frequency ?? 440} Hz`;
    default:
      return pitch.name || '音高';
  }
}

export function getFormattedPitchLabel(
  pitch: PitchDefinition,
  preset: TuningPreset,
  mode: PitchLabelMode = 'note',
  octaveShift: number = 0,
): string {
  if (mode === 'none') {
    return '';
  }

  if (mode === 'freq') {
    return formatFrequency(calculateFrequency(pitch, preset, octaveShift));
  }

  const pitchCount = preset.pitches?.length || 12;
  const edo = pitch.edo || pitchCount;
  const rawStep = pitch.step ?? 0;
  const shiftedStep = rawStep + octaveShift * edo;

  if (mode === 'step') {
    return `S${shiftedStep}`;
  }

  const cycleLength = pitchCount > 0 ? pitchCount : 12;
  const octave = 4 + Math.floor(shiftedStep / cycleLength);
  const mod = ((shiftedStep % cycleLength) + cycleLength) % cycleLength;

  if (mode === 'note') {
    if (preset.noteNames && preset.noteNames.length > 0) {
      return `${preset.noteNames[mod % preset.noteNames.length]}${octave}`;
    }
    if (edo === 12) {
      return `${NOTE_NAMES_12[mod % 12]}${octave}`;
    }
  }

  if (mode === 'doremi') {
    if (preset.doremiNames && preset.doremiNames.length > 0) {
      return `${preset.doremiNames[mod % preset.doremiNames.length]}${octave}`;
    }
    if (edo === 12) {
      return `${DOREMI_NAMES_12[mod % 12]}${octave}`;
    }
  }

  if (pitch.name) {
    return octaveShift === 0 ? pitch.name : `${pitch.name} (${octaveShift > 0 ? '+' : ''}${octaveShift}oct)`;
  }

  return `S${shiftedStep}`;
}
