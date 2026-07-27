/**
 * 標準プリセット (配置プリセット & 音高プリセット)
 */

import { LayoutPreset, TuningPreset, PitchDefinition, LaneConfig } from '../types/keyboard';
import { encodeAddress } from './address';

// 標準境界テンプレート
export const DEFAULT_BOUNDARY_TEMPLATES: Record<number, number[]> = {
  2: [0, 0.5, 1.0],
  3: [0, 0.333, 0.666, 1.0],
  4: [0, 0.25, 0.5, 0.75, 1.0],
  5: [0, 0.2, 0.4, 0.6, 0.8, 1.0],
  6: [0, 0.166, 0.333, 0.5, 0.666, 0.833, 1.0],
  7: [0, 0.142, 0.285, 0.428, 0.571, 0.714, 0.857, 1.0],
  8: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0],
};

// --- 1. 標準 12EDO 音高プリセット ---
// 1オクターブ内(12音)のみを定義
const pitch12Edo: PitchDefinition[] = Array.from({ length: 12 }, (_, i) => {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return {
    id: i,
    name: noteNames[i],
    type: 'edo',
    edo: 12,
    step: i,
  };
});

export const STANDARD_TUNING_12EDO: TuningPreset = {
  id: 'standard-tuning-12edo',
  name: '標準 12EDO 調律',
  description: '通常の12等分平均律 (1オクターブ定義・自動拡張)',
  isStandard: true,
  periodCents: 1200,
  baseAddress: encodeAddress(0, false, 0), // 横0, 白, depth0
  baseFrequency: 261.63, // C4
  baseStep: 0,
  pitches: pitch12Edo,
  noteNames: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  doremiNames: ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'],
};

// --- 2. 標準 24EDO 音高プリセット ---
// 1オクターブ内(24音)のみを定義
const noteNames24 = [
      "C",
      "C‡",
      "C#",
      "Dd",
      "D",
      "D‡",
      "D#",
      "Ed",
      "E",
      "E‡",
      "F",
      "F‡",
      "F#",
      "Gd",
      "G",
      "G‡",
      "G#",
      "Ad",
      "A",
      "A‡",
      "A#",
      "Bd",
      "B",
      "B‡"
];
const doremiNames24 = [
      "ド",
      "ド‡",
      "ド#",
      "レd",
      "レ",
      "レ‡",
      "レ#",
      "ミd",
      "ミ",
      "ミ‡",
      "ファ",
      "ファ‡",
      "ファ#",
      "ソd",
      "ソ",
      "ソ‡",
      "ソ#",
      "ラd",
      "ラ",
      "ラ‡",
      "ラ#",
      "シd",
      "シ",
      "シ‡"
];

const pitch24Edo: PitchDefinition[] = Array.from({ length: 24 }, (_, i) => {
  return {
    id: i,
    name: noteNames24[i] || `24EDO S${i}`,
    type: 'edo',
    edo: 24,
    step: i,
  };
});

export const STANDARD_TUNING_24EDO: TuningPreset = {
  id: 'standard-tuning-24edo',
  name: '標準 24EDO 調律',
  description: '四分音 (24等分平均律 - 1オクターブ定義・自動拡張)',
  isStandard: true,
  periodCents: 1200,
  baseAddress: encodeAddress(0, false, 0),
  baseFrequency: 261.63,
  baseStep: 0,
  pitches: pitch24Edo,
  noteNames: noteNames24,
  doremiNames: doremiNames24,
};

// --- 3. 標準 31EDO 音高プリセット ---
// 1オクターブ内(31音)のみを定義
const pitch31Edo: PitchDefinition[] = Array.from({ length: 31 }, (_, i) => {
  return {
    id: i,
    name: `31EDO S${i}`,
    type: 'edo',
    edo: 31,
    step: i,
  };
});

export const STANDARD_TUNING_31EDO: TuningPreset = {
  id: 'standard-tuning-31edo',
  name: '標準 31EDO 調律',
  description: '31等分平均律 (ミーントーン近似に優れた微分音 - 1オクターブ定義・自動拡張)',
  isStandard: true,
  periodCents: 1200,
  baseAddress: encodeAddress(0, false, 0),
  baseFrequency: 261.63,
  baseStep: 0,
  pitches: pitch31Edo,
  noteNames: Array.from({ length: 31 }, (_, i) => `31E_S${i}`),
  doremiNames: Array.from({ length: 31 }, (_, i) => `S${i}`),
};

// --- 4. 256番地試験用 音高プリセット ---
const pitch256Test: PitchDefinition[] = Array.from({ length: 255 }, (_, i) => ({
  id: i,
  name: `TestPitch ${i}`,
  type: 'cents',
  cents: i * (1200 / 31), // 約半音強ずつ上昇
}));

export const STANDARD_TUNING_256TEST: TuningPreset = {
  id: 'standard-tuning-256test',
  name: '256全番地試験用調律',
  description: '255個の微分音音高（256全区画検証用）',
  isStandard: true,
  periodCents: 1200,
  baseAddress: 0,
  baseFrequency: 220,
  pitches: pitch256Test,
};

// --- 全標準音高プリセット一覧 ---
export const ALL_STANDARD_TUNINGS: TuningPreset[] = [
  STANDARD_TUNING_12EDO,
  STANDARD_TUNING_24EDO,
  STANDARD_TUNING_31EDO,
  STANDARD_TUNING_256TEST,
];

// --- 5. 配置プリセット: 通常 12EDO ピアノ配置 ---
const create12EdoLayoutMapping = (): number[] => {
  const mapping = new Array<number>(256).fill(-1);
  const whiteStepsInOctave = [0, 2, 4, 5, 7, 9, 11];
  const blackStepsInOctave: Record<number, number> = {
    0: 1,  // C#
    1: 3,  // D#
    3: 6,  // F#
    4: 8,  // G#
    5: 10, // A#
  };

  for (let x = 0; x < 16; x++) {
    const oct = Math.floor(x / 7);
    const keyInOct = x % 7;
    const baseStep = oct * 12 + whiteStepsInOctave[keyInOct];
    
    mapping[encodeAddress(x, false, 0)] = baseStep;

    if (blackStepsInOctave[keyInOct] !== undefined) {
      const blackStep = oct * 12 + blackStepsInOctave[keyInOct];
      mapping[encodeAddress(x, true, 0)] = blackStep;
    }
  }
  return mapping;
};

const create12EdoLanes = (): LaneConfig[] => {
  const lanes: LaneConfig[] = [];
  for (let x = 0; x < 16; x++) {
    const keyInOct = x % 7;
    const hasBlack = keyInOct !== 2 && keyInOct !== 6; // E-F, B-C間は黒鍵なし
    lanes.push({ activeDepths: 1 }); // 白鍵
    lanes.push({ activeDepths: hasBlack ? 1 : 0 }); // 黒鍵
  }
  return lanes;
};

export const STANDARD_LAYOUT_12EDO: LayoutPreset = {
  id: 'standard-layout-12edo',
  name: '通常 12EDO ピアノ配置',
  description: '一般的な12鍵ピアノ配置 (1段仕様)',
  isStandard: true,
  defaultTuningId: 'standard-tuning-12edo',
  horizontalCount: 7,
  lanes: create12EdoLanes(),
  mapping: create12EdoLayoutMapping(),
  boundaryTemplates: { ...DEFAULT_BOUNDARY_TEMPLATES },
  invalidSectionMode: 'fixed',
};

// --- 6. 配置プリセット: 24EDO 二段鍵盤配置 ---
const create24EdoLanes = (): LaneConfig[] => {
  const lanes: LaneConfig[] = [];
  for (let x = 0; x < 16; x++) {
    const keyInOct = x % 7;
    const hasBlack = keyInOct !== 2 && keyInOct !== 6;
    lanes.push({ activeDepths: 2 }); // 白鍵2段
    lanes.push({ activeDepths: hasBlack ? 2 : 0 }); // 黒鍵2段 (E-F, B-Cは0)
  }
  return lanes;
};

const create24EdoLayoutMapping = (): number[] => {
  const mapping = new Array<number>(256).fill(-1);
  const whiteSteps: number[] = [0, 4, 8, 10, 14, 18, 22]; // C, D, E, F, G, A, B in 24EDO
  const blackSteps: Record<number, number> = {
    0: 2,  // C#
    1: 6,  // D#
    3: 12, // F#
    4: 16, // G#
    5: 20, // A#
  };

  for (let x = 0; x < 16; x++) {
    const oct = Math.floor(x / 7);
    const keyInOct = x % 7;
    const baseW = oct * 24 + whiteSteps[keyInOct];

    mapping[encodeAddress(x, false, 0)] = baseW;     // 手前
    mapping[encodeAddress(x, false, 1)] = baseW + 1; // 奥 (+1/4音)

    if (blackSteps[keyInOct] !== undefined) {
      const baseB = oct * 24 + blackSteps[keyInOct];
      mapping[encodeAddress(x, true, 0)] = baseB;     // 手前
      mapping[encodeAddress(x, true, 1)] = baseB + 1; // 奥 (+3/4音)
    }
  }
  return mapping;
};

export const STANDARD_LAYOUT_24EDO: LayoutPreset = {
  id: 'standard-layout-24edo',
  name: '24EDO 二段鍵盤配置',
  description: '手前段に通常半音、奥段に四分音(+1/4)を配した2段仕様',
  isStandard: true,
  defaultTuningId: 'standard-tuning-24edo',
  horizontalCount: 7,
  lanes: create24EdoLanes(),
  mapping: create24EdoLayoutMapping(),
  boundaryTemplates: { ...DEFAULT_BOUNDARY_TEMPLATES },
  invalidSectionMode: 'fixed',
};

// --- 7. 配置プリセット: 31EDO 多段鍵盤配置 (確定仕様に完全準拠) ---
const create31EdoLanes = (): LaneConfig[] => {
  const lanes: LaneConfig[] = [];
  for (let x = 0; x < 16; x++) {
    const keyInOct = x % 7;
    const hasBlack = keyInOct !== 2 && keyInOct !== 6;
    lanes.push({ activeDepths: 3 }); // 白鍵3段
    lanes.push({ activeDepths: hasBlack ? 2 : 0 }); // 黒鍵2段 (E-F, B-Cは0)
  }
  return lanes;
};

const create31EdoLayoutMapping = (): number[] => {
  const mapping = new Array<number>(256).fill(-1);
  // C白: 0,1,2 / D白: 5,6,7 / E白: 10,11,12 / F白: 13,14,15 / G白: 18,19,20 / A白: 23,24,25 / B白: 28,29,30
  const whiteSteps: number[][] = [
    [0, 1, 2],    // C
    [5, 6, 7],    // D
    [10, 11, 12], // E
    [13, 14, 15], // F
    [18, 19, 20], // G
    [23, 24, 25], // A
    [28, 29, 30], // B
  ];

  // C#黒: 3,4 / D#黒: 8,9 / F#黒: 16,17 / G#黒: 21,22 / A#黒: 26,27
  const blackSteps: Record<number, number[]> = {
    0: [3, 4],   // C#
    1: [8, 9],   // D#
    3: [16, 17], // F#
    4: [21, 22], // G#
    5: [26, 27], // A#
  };

  for (let x = 0; x < 16; x++) {
    const oct = Math.floor(x / 7);
    const keyInOct = x % 7;

    const wArr = whiteSteps[keyInOct];
    for (let d = 0; d < 3; d++) {
      const step = oct * 31 + wArr[d];
      mapping[encodeAddress(x, false, d)] = step;
    }

    if (blackSteps[keyInOct] !== undefined) {
      const bArr = blackSteps[keyInOct];
      for (let d = 0; d < 2; d++) {
        const step = oct * 31 + bArr[d];
        mapping[encodeAddress(x, true, d)] = step;
      }
    }
  }
  return mapping;
};

export const STANDARD_LAYOUT_31EDO: LayoutPreset = {
  id: 'standard-layout-31edo',
  name: '31EDO 多段鍵盤配置',
  description: '白鍵3段・黒鍵2段で31等分音を配置した多段仕様 (確定仕様準拠)',
  isStandard: true,
  defaultTuningId: 'standard-tuning-31edo',
  horizontalCount: 7,
  lanes: create31EdoLanes(),
  mapping: create31EdoLayoutMapping(),
  boundaryTemplates: { ...DEFAULT_BOUNDARY_TEMPLATES },
  invalidSectionMode: 'fixed',
};

// --- 8. 配置プリセット: 全256番地試験配置 ---
const create256TestLayoutMapping = (): number[] => {
  const mapping = new Array<number>(256).fill(-1);
  let pitchIdx = 0;
  for (let x = 0; x < 16; x++) {
    for (let d = 0; d < 8; d++) {
      mapping[encodeAddress(x, false, d)] = (pitchIdx++) % 255;
    }
    for (let d = 0; d < 8; d++) {
      mapping[encodeAddress(x, true, d)] = (pitchIdx++) % 255;
    }
  }
  return mapping;
};

export const STANDARD_LAYOUT_256TEST: LayoutPreset = {
  id: 'standard-layout-256test',
  name: '全256番地試験配置',
  description: '16x2x8=256全区画が有効なテスト用配置',
  isStandard: true,
  lanes: Array.from({ length: 32 }, () => ({ activeDepths: 8 })),
  mapping: create256TestLayoutMapping(),
  boundaryTemplates: { ...DEFAULT_BOUNDARY_TEMPLATES },
  invalidSectionMode: 'fixed',
};

// --- 9. 配置プリセット: 空カスタム配置 ---
export const STANDARD_LAYOUT_EMPTY: LayoutPreset = {
  id: 'standard-layout-empty',
  name: '空カスタム配置',
  description: '全区画が全8段有効で未割当(-1)の新規作成用配置',
  isStandard: true,
  lanes: Array.from({ length: 32 }, () => ({ activeDepths: 8 })),
  mapping: new Array<number>(256).fill(-1),
  boundaryTemplates: { ...DEFAULT_BOUNDARY_TEMPLATES },
  invalidSectionMode: 'fixed',
};

export const ALL_STANDARD_LAYOUTS: LayoutPreset[] = [
  STANDARD_LAYOUT_12EDO,
  STANDARD_LAYOUT_24EDO,
  STANDARD_LAYOUT_31EDO,
  STANDARD_LAYOUT_256TEST,
  STANDARD_LAYOUT_EMPTY,
];
