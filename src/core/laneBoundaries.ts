import {LaneConfig, LayoutPreset} from '../types/keyboard';

function createEvenBoundaries(activeDepths: number): number[] {
  if (activeDepths <= 0) {
    return [0, 1];
  }
  return Array.from({length: activeDepths + 1}, (_, index) => index / activeDepths);
}

export function sanitizeBoundaries(boundaries: number[], activeDepths: number): number[] {
  if (activeDepths <= 0) {
    return [0, 1];
  }

  const expectedLength = activeDepths + 1;
  if (boundaries.length !== expectedLength) {
    return createEvenBoundaries(activeDepths);
  }

  const next = [...boundaries];
  next[0] = 0;
  next[next.length - 1] = 1;

  for (let index = 1; index < next.length - 1; index += 1) {
    next[index] = Math.max(next[index - 1], Math.min(1, next[index]));
  }

  for (let index = next.length - 2; index >= 1; index -= 1) {
    next[index] = Math.min(next[index + 1], Math.max(0, next[index]));
  }

  return next;
}

export function getLaneBoundaries(layout: LayoutPreset, lane: LaneConfig | undefined): number[] {
  const activeDepths = lane?.activeDepths ?? 0;
  if (activeDepths <= 0) {
    return [0, 1];
  }

  if (lane?.customBoundaries?.length === activeDepths + 1) {
    return sanitizeBoundaries(lane.customBoundaries, activeDepths);
  }

  const template = layout.boundaryTemplates?.[activeDepths];
  if (template?.length === activeDepths + 1) {
    return sanitizeBoundaries(template, activeDepths);
  }

  return createEvenBoundaries(activeDepths);
}

export function getSegmentHeightsFromBoundaries(boundaries: number[]): number[] {
  const heights: number[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    heights.push(Math.max(0, boundaries[index + 1] - boundaries[index]));
  }
  return heights;
}

export function getDepthFromBoundaries(topRatio: number, activeDepths: number, boundaries: number[]): number {
  if (activeDepths <= 0) {
    return 0;
  }

  const clampedTopRatio = Math.max(0, Math.min(0.9999, topRatio));
  for (let index = 0; index < activeDepths; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (clampedTopRatio >= start && clampedTopRatio < end) {
      return activeDepths - 1 - index;
    }
  }

  return 0;
}
