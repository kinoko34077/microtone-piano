import {encodeAddress} from './address';
import {calculateFrequency, resolvePitch} from './pitch';
import {LayoutPreset, TuningPreset} from '../types/keyboard';

const MIN_DISPLAY_FREQUENCY = 13.75;
const MAX_DISPLAY_FREQUENCY = 8372.02;
const MAX_REPEAT_ABS = 64;
const MIN_DISPLAY_MIDI = 9;
const MAX_DISPLAY_MIDI = 120;
const TWELVE_EDO_WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11];

export interface KeyboardColumnRange {
  period: number;
  startRepeat: number;
  endRepeat: number;
  startColumn: number;
  endColumn: number;
  totalColumns: number;
  maxScrollOffset: number;
}

function clampRepeat(value: number): number {
  return Math.max(-MAX_REPEAT_ABS, Math.min(MAX_REPEAT_ABS, value));
}

function getRepeatBounds(baseFrequency: number, periodRatio: number): {minRepeat: number; maxRepeat: number} | null {
  if (!Number.isFinite(baseFrequency) || baseFrequency <= 0 || !Number.isFinite(periodRatio) || periodRatio <= 1) {
    return null;
  }

  const logRatio = Math.log(periodRatio);
  const minRepeat = clampRepeat(
    Math.ceil((Math.log(MIN_DISPLAY_FREQUENCY / baseFrequency) / logRatio) - 1e-9),
  );
  const maxRepeat = clampRepeat(
    Math.floor((Math.log(MAX_DISPLAY_FREQUENCY / baseFrequency) / logRatio) + 1e-9),
  );

  if (minRepeat > maxRepeat) {
    return null;
  }

  return {minRepeat, maxRepeat};
}

export function getKeyboardColumnRange(
  layout: LayoutPreset,
  tuning: TuningPreset,
  octaveShift: number,
): KeyboardColumnRange {
  const period = Math.max(1, layout.horizontalCount || 16);
  const periodRatio = Math.pow(2, (tuning.periodCents || 1200) / 1200);
  const noteBoundedColumns = getTwelveEdoNoteBoundedColumns(layout, tuning);
  if (noteBoundedColumns) {
    const totalColumns = noteBoundedColumns.endColumn - noteBoundedColumns.startColumn + 1;
    return {
      period,
      startRepeat: Math.floor(noteBoundedColumns.startColumn / period),
      endRepeat: Math.floor(noteBoundedColumns.endColumn / period),
      startColumn: noteBoundedColumns.startColumn,
      endColumn: noteBoundedColumns.endColumn,
      totalColumns,
      maxScrollOffset: Math.max(0, totalColumns - 1),
    };
  }

  let startRepeat = Number.POSITIVE_INFINITY;
  let endRepeat = Number.NEGATIVE_INFINITY;

  for (let baseX = 0; baseX < period; baseX += 1) {
    for (const isBlack of [false, true]) {
      const lane = layout.lanes[baseX * 2 + (isBlack ? 1 : 0)];
      const activeDepths = Math.max(0, Math.min(8, lane?.activeDepths ?? 0));

      for (let depth = 0; depth < activeDepths; depth += 1) {
        const pitchRef = layout.mapping[encodeAddress(baseX, isBlack, depth)];
        const {pitchDef, octaveShift: pitchOctaveShift} = resolvePitch(pitchRef, tuning);
        if (!pitchDef) {
          continue;
        }

        const baseFrequency = calculateFrequency(pitchDef, tuning, octaveShift + pitchOctaveShift);
        const bounds = getRepeatBounds(baseFrequency, periodRatio);
        if (!bounds) {
          continue;
        }

        startRepeat = Math.min(startRepeat, bounds.minRepeat);
        endRepeat = Math.max(endRepeat, bounds.maxRepeat);
      }
    }
  }

  if (!Number.isFinite(startRepeat) || !Number.isFinite(endRepeat)) {
    startRepeat = 0;
    endRepeat = 0;
  }

  const startColumn = startRepeat * period;
  const endColumn = ((endRepeat + 1) * period) - 1;
  const totalColumns = Math.max(period, endColumn - startColumn + 1);
  return {
    period,
    startRepeat,
    endRepeat,
    startColumn,
    endColumn,
    totalColumns,
    maxScrollOffset: Math.max(0, totalColumns - 1),
  };
}

function getTwelveEdoNoteBoundedColumns(
  layout: LayoutPreset,
  tuning: TuningPreset,
): {startColumn: number; endColumn: number} | null {
  if ((tuning.periodCents || 1200) !== 1200 || periodBaseDoesNotRepresentC(tuning)) {
    return null;
  }

  const period = Math.max(1, layout.horizontalCount || 16);
  if (period !== 7) {
    return null;
  }

  let startColumn: number | null = null;
  let endColumn: number | null = null;
  for (let repeat = -MAX_REPEAT_ABS; repeat <= MAX_REPEAT_ABS; repeat += 1) {
    for (let baseX = 0; baseX < period; baseX += 1) {
      const midi = 60 + repeat * 12 + TWELVE_EDO_WHITE_STEPS[baseX % 7];
      const absoluteColumn = repeat * period + baseX;
      if (midi >= MIN_DISPLAY_MIDI && midi <= MAX_DISPLAY_MIDI) {
        startColumn = startColumn === null ? absoluteColumn : Math.min(startColumn, absoluteColumn);
        endColumn = endColumn === null ? absoluteColumn : Math.max(endColumn, absoluteColumn);
      }
    }
  }

  if (startColumn === null || endColumn === null) {
    return null;
  }

  return {startColumn, endColumn};
}

function periodBaseDoesNotRepresentC(tuning: TuningPreset): boolean {
  return Math.abs((tuning.baseFrequency || 261.63) - 261.63) > 0.5 || (tuning.baseStep ?? 0) !== 0;
}
