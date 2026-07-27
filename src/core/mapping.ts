/**
 * 自動マッピング処理モジュール
 */

import { LayoutPreset, PitchDefinition, LaneConfig } from '../types/keyboard';
import { encodeAddress } from './address';

/**
 * 走査順に沿って、有効な区画にPitchIDを順番に割り振る
 */
export function applyAutoMapping(
  layout: LayoutPreset,
  pitches: PitchDefinition[],
  direction: 'lowToHigh' | 'highToLow' = 'lowToHigh'
): number[] {
  const newMapping = new Array<number>(256).fill(-1);
  const pitchIds = pitches.map((p) => p.id);

  if (pitchIds.length === 0) return newMapping;

  // 走査順アドレス収集: 横位置0白 -> 0黒 -> 1白 -> 1黒...
  const targetAddresses: number[] = [];

  for (let x = 0; x < 16; x++) {
    // 白鍵レーン (2 * x)
    const whiteLane = layout.lanes[x * 2];
    const whiteActive = whiteLane ? whiteLane.activeDepths : 0;
    const whiteDepths = direction === 'lowToHigh'
      ? Array.from({ length: whiteActive }, (_, d) => d)
      : Array.from({ length: whiteActive }, (_, d) => whiteActive - 1 - d);

    for (const d of whiteDepths) {
      targetAddresses.push(encodeAddress(x, false, d));
    }

    // 黒鍵レーン (2 * x + 1)
    const blackLane = layout.lanes[x * 2 + 1];
    const blackActive = blackLane ? blackLane.activeDepths : 0;
    const blackDepths = direction === 'lowToHigh'
      ? Array.from({ length: blackActive }, (_, d) => d)
      : Array.from({ length: blackActive }, (_, d) => blackActive - 1 - d);

    for (const d of blackDepths) {
      targetAddresses.push(encodeAddress(x, true, d));
    }
  }

  // 収集した有効アドレスに対し、音高IDを1対1で割り当てる（余剰は未割当-1のまま）
  for (let i = 0; i < Math.min(targetAddresses.length, pitchIds.length); i++) {
    const addr = targetAddresses[i];
    newMapping[addr] = pitchIds[i];
  }

  return newMapping;
}
