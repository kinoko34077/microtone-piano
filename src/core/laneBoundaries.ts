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

/**
 * Shared vertical geometry for keyboard display and pointer hit testing.
 * When invalid slots are shown, their legacy one-eighth guide cells remain
 * visible, but active cells retain the lane's configured relative boundaries.
 * This is a preview-consistency fix, NOT a definition of the fixed/compressed/
 * custom layout mode semantics (microtone-piano #38).
 */
export interface LaneDisplaySegment {
  depth: number;
  heightPercent: number;
  isInvalid: boolean;
}

export function getLaneDisplaySegments(
  layout: LayoutPreset,
  lane: LaneConfig | undefined,
  isBlack: boolean,
  showInvalidSections: boolean,
): LaneDisplaySegment[] {
  const activeDepths = Math.max(0, Math.min(8, lane?.activeDepths ?? 0));
  if (!showInvalidSections && activeDepths === 0) return [];

  const activeHeights = activeDepths > 0
    ? getSegmentHeightsFromBoundaries(getLaneBoundaries(layout, lane, isBlack))
    : [];

  if (!showInvalidSections) {
    return activeHeights.map((fraction, index) => ({
      depth: activeDepths - 1 - index,
      heightPercent: fraction * 100,
      isInvalid: false,
    }));
  }

  const inactiveCount = 8 - activeDepths;
  return [
    ...Array.from({length: inactiveCount}, (_, index) => ({
      depth: 7 - index,
      heightPercent: 100 / 8,
      isInvalid: true,
    })),
    ...activeHeights.map((fraction, index) => ({
      depth: activeDepths - 1 - index,
      heightPercent: fraction * (activeDepths / 8) * 100,
      isInvalid: false,
    })),
  ];
}

export function getDepthFromDisplaySegments(topRatio: number, segments: LaneDisplaySegment[]): number {
  if (segments.length === 0) return 0;
  const position = Math.max(0, Math.min(0.9999, topRatio)) * 100;
  let cumulative = 0;
  for (const segment of segments) {
    cumulative += segment.heightPercent;
    if (position < cumulative) return segment.depth;
  }
  // Avoid a floating-point gap at the bottom edge of the last segment.
  return segments[segments.length - 1].depth;
}
