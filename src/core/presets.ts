import {LayoutPreset, TuningPreset, PitchDefinition, LaneConfig} from '../types/keyboard';
import {encodeAddress} from './address';

export const DEFAULT_BOUNDARY_TEMPLATES: Record<number, number[]> = {
  2: [0, 0.5, 1.0],
  3: [0, 0.333, 0.666, 1.0],
  4: [0, 0.25, 0.5, 0.75, 1.0],
  5: [0, 0.2, 0.4, 0.6, 0.8, 1.0],
  6: [0, 0.166, 0.333, 0.5, 0.666, 0.833, 1.0],
  7: [0, 0.142, 0.285, 0.428, 0.571, 0.714, 0.857, 1.0],
  8: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0],
};

const noteNames12 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const doremiNames12 = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];

const noteNames24 = [
  'C', 'C+', 'C#', 'D-',
  'D', 'D+', 'D#', 'E-',
  'E', 'E+', 'F', 'F+',
  'F#', 'G-', 'G', 'G+',
  'G#', 'A-', 'A', 'A+',
  'A#', 'B-', 'B', 'B+',
];

const doremiNames24 = [
  'ド', 'ド+', 'ド#', 'レ-',
  'レ', 'レ+', 'レ#', 'ミ-',
  'ミ', 'ミ+', 'ファ', 'ファ+',
  'ファ#', 'ソ-', 'ソ', 'ソ+',
  'ソ#', 'ラ-', 'ラ', 'ラ+',
  'ラ#', 'シ-', 'シ', 'シ+',
];

const pitch12Edo: PitchDefinition[] = Array.from({length: 12}, (_, i) => ({
  id: i,
  name: noteNames12[i],
  type: 'edo',
  edo: 12,
  step: i,
}));

const pitch24Edo: PitchDefinition[] = Array.from({length: 24}, (_, i) => ({
  id: i,
  name: noteNames24[i] ?? `24EDO S${i}`,
  type: 'edo',
  edo: 24,
  step: i,
}));

const pitch31Edo: PitchDefinition[] = Array.from({length: 31}, (_, i) => ({
  id: i,
  name: `31EDO S${i}`,
  type: 'edo',
  edo: 31,
  step: i,
}));

const pitch256Test: PitchDefinition[] = Array.from({length: 255}, (_, i) => ({
  id: i,
  name: `TestPitch ${i}`,
  type: 'cents',
  cents: i * (1200 / 31),
}));

export const STANDARD_TUNING_12EDO: TuningPreset = {
  id: 'standard-tuning-12edo',
  name: '標準 12EDO 音高',
  description: '一般的な12平均律の1オクターブ12音です。',
  isStandard: true,
  periodCents: 1200,
  baseAddress: encodeAddress(0, false, 0),
  baseFrequency: 261.63,
  baseStep: 0,
  pitches: pitch12Edo,
  noteNames: noteNames12,
  doremiNames: doremiNames12,
};

export const STANDARD_TUNING_24EDO: TuningPreset = {
  id: 'standard-tuning-24edo',
  name: '標準 24EDO 音高',
  description: '24平均律の1オクターブ24音です。',
  isStandard: true,
  periodCents: 1200,
  baseAddress: encodeAddress(0, false, 0),
  baseFrequency: 261.63,
  baseStep: 0,
  pitches: pitch24Edo,
  noteNames: noteNames24,
  doremiNames: doremiNames24,
};

export const STANDARD_TUNING_31EDO: TuningPreset = {
  id: 'standard-tuning-31edo',
  name: '標準 31EDO 音高',
  description: '31平均律を多段鍵盤向けに並べた定義です。',
  isStandard: true,
  periodCents: 1200,
  baseAddress: encodeAddress(0, false, 0),
  baseFrequency: 261.63,
  baseStep: 0,
  pitches: pitch31Edo,
  noteNames: Array.from({length: 31}, (_, i) => `31E_S${i}`),
  doremiNames: Array.from({length: 31}, (_, i) => `S${i}`),
};

export const STANDARD_TUNING_256TEST: TuningPreset = {
  id: 'standard-tuning-256test',
  name: '256段テスト音高',
  description: '255音を並べたテスト用の音高セットです。',
  isStandard: true,
  periodCents: 1200,
  baseAddress: 0,
  baseFrequency: 220,
  pitches: pitch256Test,
};

export const ALL_STANDARD_TUNINGS: TuningPreset[] = [
  STANDARD_TUNING_12EDO,
  STANDARD_TUNING_24EDO,
  STANDARD_TUNING_31EDO,
  STANDARD_TUNING_256TEST,
];

const create12EdoLayoutMapping = (): number[] => {
  const mapping = new Array<number>(256).fill(-1);
  const whiteStepsInOctave = [0, 2, 4, 5, 7, 9, 11];
  const blackStepsInOctave: Record<number, number> = {
    0: 1,
    1: 3,
    3: 6,
    4: 8,
    5: 10,
  };

  for (let x = 0; x < 16; x += 1) {
    const octave = Math.floor(x / 7);
    const keyInOctave = x % 7;
    const baseStep = octave * 12 + whiteStepsInOctave[keyInOctave];
    mapping[encodeAddress(x, false, 0)] = baseStep;

    if (blackStepsInOctave[keyInOctave] !== undefined) {
      mapping[encodeAddress(x, true, 0)] = octave * 12 + blackStepsInOctave[keyInOctave];
    }
  }

  return mapping;
};

const create12EdoLanes = (): LaneConfig[] => {
  const lanes: LaneConfig[] = [];
  for (let x = 0; x < 16; x += 1) {
    const keyInOctave = x % 7;
    const hasBlack = keyInOctave !== 2 && keyInOctave !== 6;
    lanes.push({activeDepths: 1});
    lanes.push({activeDepths: hasBlack ? 1 : 0});
  }
  return lanes;
};

const create24EdoLanes = (): LaneConfig[] => {
  const lanes: LaneConfig[] = [];
  for (let x = 0; x < 16; x += 1) {
    const keyInOctave = x % 7;
    const hasBlack = keyInOctave !== 2 && keyInOctave !== 6;
    lanes.push({activeDepths: 2});
    lanes.push({activeDepths: hasBlack ? 2 : 0});
  }
  return lanes;
};

const create24EdoLayoutMapping = (): number[] => {
  const mapping = new Array<number>(256).fill(-1);
  const whiteSteps = [0, 4, 8, 10, 14, 18, 22];
  const blackSteps: Record<number, number> = {
    0: 2,
    1: 6,
    3: 12,
    4: 16,
    5: 20,
  };

  for (let x = 0; x < 16; x += 1) {
    const octave = Math.floor(x / 7);
    const keyInOctave = x % 7;
    const baseWhite = octave * 24 + whiteSteps[keyInOctave];

    mapping[encodeAddress(x, false, 0)] = baseWhite;
    mapping[encodeAddress(x, false, 1)] = baseWhite + 1;

    if (blackSteps[keyInOctave] !== undefined) {
      const baseBlack = octave * 24 + blackSteps[keyInOctave];
      mapping[encodeAddress(x, true, 0)] = baseBlack;
      mapping[encodeAddress(x, true, 1)] = baseBlack + 1;
    }
  }

  return mapping;
};

const create31EdoLanes = (): LaneConfig[] => {
  const lanes: LaneConfig[] = [];
  for (let x = 0; x < 16; x += 1) {
    const keyInOctave = x % 7;
    const hasBlack = keyInOctave !== 2 && keyInOctave !== 6;
    lanes.push({activeDepths: 3});
    lanes.push({activeDepths: hasBlack ? 2 : 0});
  }
  return lanes;
};

const create31EdoLayoutMapping = (): number[] => {
  const mapping = new Array<number>(256).fill(-1);
  const whiteSteps: number[][] = [
    [0, 1, 2],
    [5, 6, 7],
    [10, 11, 12],
    [13, 14, 15],
    [18, 19, 20],
    [23, 24, 25],
    [28, 29, 30],
  ];

  const blackSteps: Record<number, number[]> = {
    0: [3, 4],
    1: [8, 9],
    3: [16, 17],
    4: [21, 22],
    5: [26, 27],
  };

  for (let x = 0; x < 16; x += 1) {
    const octave = Math.floor(x / 7);
    const keyInOctave = x % 7;
    const whiteGroup = whiteSteps[keyInOctave];

    for (let depth = 0; depth < 3; depth += 1) {
      mapping[encodeAddress(x, false, depth)] = octave * 31 + whiteGroup[depth];
    }

    if (blackSteps[keyInOctave]) {
      const blackGroup = blackSteps[keyInOctave];
      for (let depth = 0; depth < 2; depth += 1) {
        mapping[encodeAddress(x, true, depth)] = octave * 31 + blackGroup[depth];
      }
    }
  }

  return mapping;
};

const create256TestLayoutMapping = (): number[] => {
  const mapping = new Array<number>(256).fill(-1);
  let pitchIndex = 0;
  for (let x = 0; x < 16; x += 1) {
    for (let depth = 0; depth < 8; depth += 1) {
      mapping[encodeAddress(x, false, depth)] = (pitchIndex++) % 255;
    }
    for (let depth = 0; depth < 8; depth += 1) {
      mapping[encodeAddress(x, true, depth)] = (pitchIndex++) % 255;
    }
  }
  return mapping;
};

export const STANDARD_LAYOUT_12EDO: LayoutPreset = {
  id: 'standard-layout-12edo',
  name: '標準 12EDO 鍵盤配置',
  description: '1段の12EDO鍵盤です。',
  isStandard: true,
  defaultTuningId: 'standard-tuning-12edo',
  horizontalCount: 7,
  lanes: create12EdoLanes(),
  mapping: create12EdoLayoutMapping(),
  boundaryTemplates: {...DEFAULT_BOUNDARY_TEMPLATES},
  invalidSectionMode: 'fixed',
};

export const STANDARD_LAYOUT_24EDO: LayoutPreset = {
  id: 'standard-layout-24edo',
  name: '24EDO 2段鍵盤配置',
  description: '白鍵2段、黒鍵2段の24EDO配置です。',
  isStandard: true,
  defaultTuningId: 'standard-tuning-24edo',
  horizontalCount: 7,
  lanes: create24EdoLanes(),
  mapping: create24EdoLayoutMapping(),
  boundaryTemplates: {...DEFAULT_BOUNDARY_TEMPLATES},
  invalidSectionMode: 'fixed',
};

export const STANDARD_LAYOUT_31EDO: LayoutPreset = {
  id: 'standard-layout-31edo',
  name: '31EDO 多段鍵盤配置',
  description: '白鍵3段、黒鍵2段の31EDO配置です。',
  isStandard: true,
  defaultTuningId: 'standard-tuning-31edo',
  horizontalCount: 7,
  lanes: create31EdoLanes(),
  mapping: create31EdoLayoutMapping(),
  boundaryTemplates: {...DEFAULT_BOUNDARY_TEMPLATES},
  invalidSectionMode: 'fixed',
};

export const STANDARD_LAYOUT_256TEST: LayoutPreset = {
  id: 'standard-layout-256test',
  name: '256段テスト配置',
  description: '全256区画を埋めたテスト用配置です。',
  isStandard: true,
  lanes: Array.from({length: 32}, () => ({activeDepths: 8})),
  mapping: create256TestLayoutMapping(),
  boundaryTemplates: {...DEFAULT_BOUNDARY_TEMPLATES},
  invalidSectionMode: 'fixed',
};

export const STANDARD_LAYOUT_EMPTY: LayoutPreset = {
  id: 'standard-layout-empty',
  name: '空のカスタム配置',
  description: '全区画が未割当の新規作成用配置です。',
  isStandard: true,
  lanes: Array.from({length: 32}, () => ({activeDepths: 8})),
  mapping: new Array<number>(256).fill(-1),
  boundaryTemplates: {...DEFAULT_BOUNDARY_TEMPLATES},
  invalidSectionMode: 'fixed',
};

export const ALL_STANDARD_LAYOUTS: LayoutPreset[] = [
  STANDARD_LAYOUT_12EDO,
  STANDARD_LAYOUT_24EDO,
  STANDARD_LAYOUT_31EDO,
  STANDARD_LAYOUT_256TEST,
  STANDARD_LAYOUT_EMPTY,
];
