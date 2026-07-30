import {encodeAddress} from './address';
import {calculateFrequency, resolvePitch} from './pitch';
import {LayoutPreset, TuningPreset} from '../types/keyboard';

const MIN_DISPLAY_FREQUENCY = 13.75;
const MAX_DISPLAY_FREQUENCY = 8372.02;
const MAX_REPEAT_ABS = 64;

export interface KeyboardColumnRange {
  period: number;
  startRepeat: number;
  endRepeat: number;
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

  const totalColumns = Math.max(period, (endRepeat - startRepeat + 1) * period);
  return {
    period,
    startRepeat,
    endRepeat,
    totalColumns,
    maxScrollOffset: Math.max(0, totalColumns - 1),
  };
}
