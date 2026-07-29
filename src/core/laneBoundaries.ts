import {LaneConfig, LayoutPreset} from '../types/keyboard';

function createEvenBoundaries(activeDepths: number): number[] {
  if (activeDepths <= 0) {
    return [0, 1];
  }
  return Array.from({length: activeDepths + 1}, (_, index) => index / activeDepths);
}

function getTemplateMap(layout: LayoutPreset, isBlack: boolean): Record<number, number[]> {
  if (isBlack) {
    return layout.blackBoundaryTemplates ?? layout.boundaryTemplates ?? {};
  }
  return layout.whiteBoundaryTemplates ?? layout.boundaryTemplates ?? {};
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

export function getTemplateBoundaries(layout: LayoutPreset, activeDepths: number, isBlack: boolean): number[] {
  if (activeDepths <= 0) {
    return [0, 1];
  }

  const template = getTemplateMap(layout, isBlack)?.[activeDepths];
  if (template?.length === activeDepths + 1) {
    return sanitizeBoundaries(template, activeDepths);
  }

  const legacyTemplate = layout.boundaryTemplates?.[activeDepths];
  if (legacyTemplate?.length === activeDepths + 1) {
    return sanitizeBoundaries(legacyTemplate, activeDepths);
  }

  return createEvenBoundaries(activeDepths);
}

export function getLaneBoundaries(layout: LayoutPreset, lane: LaneConfig | undefined, isBlack: boolean = false): number[] {
  const activeDepths = lane?.activeDepths ?? 0;
  if (activeDepths <= 0) {
    return [0, 1];
  }

  if (lane?.customBoundaries?.length === activeDepths + 1) {
    return sanitizeBoundaries(lane.customBoundaries, activeDepths);
  }

  return getTemplateBoundaries(layout, activeDepths, isBlack);
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
