/**
 * 多段微分音 Web 鍵盤の共通型定義
 */

export type PitchType = 'edo' | 'cents' | 'ratio' | 'frequency';

export interface PitchDefinition {
  id: number;
  name: string;
  type: PitchType;
  edo?: number;
  step?: number;
  cents?: number;
  numerator?: number;
  denominator?: number;
  frequency?: number;
}

export interface TuningPreset {
  id: string;
  name: string;
  description?: string;
  isStandard?: boolean;
  periodCents: number;
  baseAddress: number;
  baseFrequency: number;
  baseStep?: number;
  pitches: PitchDefinition[];
  noteNames?: string[];
  doremiNames?: string[];
}

export type InvalidSectionMode = 'fixed' | 'compressed' | 'custom';

export type BoundaryTemplate = number[];

export interface LaneConfig {
  activeDepths: number;
  customBoundaries?: number[];
}

export interface LayoutPreset {
  id: string;
  name: string;
  description?: string;
  isStandard?: boolean;
  defaultTuningId?: string;
  horizontalCount?: number;
  lanes: LaneConfig[];
  mapping: number[];
  slotFlags?: boolean[];
  boundaryTemplates: Record<number, number[]>;
  invalidSectionMode: InvalidSectionMode;
}

export type PitchLabelMode = 'note' | 'doremi' | 'step' | 'freq' | 'none';

export interface AppSettings {
  soundSource: 'piano' | 'sawtooth' | 'square';
  masterVolume: number;
  noteDecayMs?: number;
  pianoSampleOverrides?: Record<string, {baseFrequency: number; noteLabel: string}>;
  sustainLatch: boolean;
  sustainMomentary?: boolean;
  keyWidth: number;
  upperKeyWidth?: number;
  lowerKeyWidth?: number;
  visibleKeysCount: number;
  upperScrollOffset?: number;
  lowerScrollOffset?: number;
  showTwoRows: boolean;
  showInvalidSections: boolean;
  autoMappingDirection: 'lowToHigh' | 'highToLow';
  blackKeyWidthRatio: number;
  blackKeyHeightRatio: number;
  pcDepthOffset: number;
  upperOctaveOffset: number;
  lowerOctaveOffset: number;
  showAddressBinary?: boolean;
  pitchLabelMode: PitchLabelMode;
  defaultLayoutPresetId?: string;
  defaultPitchPresetId?: string;
}

export interface ActiveVoice {
  id: string;
  address: number;
  pitchId: number;
  frequency: number;
  velocity: number;
  startTime: number;
  pointerId?: number | string;
}

export interface OutOfRangeNotice {
  id: string;
  frequency: number;
  address: number;
  message: string;
  timestamp: number;
}
