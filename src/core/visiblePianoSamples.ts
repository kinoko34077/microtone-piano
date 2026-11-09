import {encodeAddress, isPlayableAddress} from './address';
import {isBlackColumnInDisplayPitchRange, KeyboardColumnRange} from './keyboardRange';
import {calculateFrequency, resolvePitch} from './pitch';
import {LayoutPreset, TuningPreset} from '../types/keyboard';

/**
 * Exact sound frequencies for the rendered keyboard columns (including the
 * existing one-column overscan). Uses the same pitch-reference / octave repeat
 * logic as InteractiveKeyboard, rather than guessing samples from key labels.
 */
export function getVisiblePianoFrequencies(
  layout: LayoutPreset,
  tuning: TuningPreset,
  columnRange: KeyboardColumnRange,
  firstVisibleColumn: number,
  lastVisibleColumn: number,
): number[] {
  const frequencies: number[] = [];
  if (lastVisibleColumn < firstVisibleColumn) return frequencies;

  const {period, startColumn, totalColumns} = columnRange;
  const first = Math.max(0, firstVisibleColumn);
  const last = Math.min(totalColumns - 1, lastVisibleColumn);
  for (let column = first; column <= last; column += 1) {
    const absoluteColumn = startColumn + column;
    const baseX = ((absoluteColumn % period) + period) % period;
    const repeat = Math.floor(absoluteColumn / period);
    for (const black of [false, true]) {
      if (black && !isBlackColumnInDisplayPitchRange(absoluteColumn, period)) continue;
      const activeDepths = Math.max(0, Math.min(8, layout.lanes[baseX * 2 + (black ? 1 : 0)]?.activeDepths ?? 0));
      for (let depth = 0; depth < activeDepths; depth += 1) {
        const address = encodeAddress(baseX, black, depth);
        if (!isPlayableAddress(layout, address)) continue;
        const {pitchDef, octaveShift} = resolvePitch(layout.mapping[address], tuning);
        if (!pitchDef) continue;
        const frequency = calculateFrequency(pitchDef, tuning, octaveShift + repeat);
        if (Number.isFinite(frequency) && frequency > 0) frequencies.push(frequency);
      }
    }
  }
  return frequencies;
}
