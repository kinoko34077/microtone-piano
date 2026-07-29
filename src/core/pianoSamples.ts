import {TuningPreset} from '../types/keyboard';
import {calculateFrequency, encodePitchReference, getFormattedPitchLabel, resolvePitch} from './pitch';

export type PianoSampleRow = [fileName: string, baseFrequency: number, noteLabel: string];

export interface PianoSampleDefinition {
  id: string;
  fileName: string;
  url: string;
  baseFrequency: number;
  referenceFrequency: number;
  noteLabel: string;
  pitchId?: number;
  octaveShift?: number;
}

export type PianoSampleOverrideMap = Record<string, {pitchId?: number; octaveShift?: number; baseFrequency?: number; noteLabel?: string}>;

const DEFAULT_OCTAVE_SEARCH_MIN = -8;
const DEFAULT_OCTAVE_SEARCH_MAX = 8;

const sampleUrls = import.meta.glob('../../Grand Piano/*.wav', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

export const DEFAULT_PIANO_SAMPLE_ROWS: PianoSampleRow[] = [
  ['FL Piano (1).wav', 27.56, 'A0'],
  ['FL Piano (2).wav', 29.21, 'A#0'],
  ['FL Piano (3).wav', 58.33, 'A#1'],
  ['FL Piano (4).wav', 116.98, 'A#2'],
  ['FL Piano (5).wav', 235.83, 'A#3'],
  ['FL Piano (6).wav', 474.19, 'A#4'],
  ['FL Piano (7).wav', 958.7, 'A#5'],
  ['FL Piano (8).wav', 1917.39, 'A#6'],
  ['FL Piano (9).wav', 1837.5, 'A#6'],
  ['FL Piano (10).wav', 32.79, 'C1'],
  ['FL Piano (11).wav', 65.82, 'C2'],
  ['FL Piano (12).wav', 131.64, 'C3'],
  ['FL Piano (13).wav', 264.07, 'C4'],
  ['FL Piano (14).wav', 531.33, 'C5'],
  ['FL Piano (15).wav', 1050.0, 'C6'],
  ['FL Piano (16).wav', 2100.0, 'C7'],
  ['FL Piano (17).wav', 2100.0, 'C7'],
  ['FL Piano (18).wav', 36.78, 'D1'],
  ['FL Piano (19).wav', 73.87, 'D2'],
  ['FL Piano (20).wav', 147.49, 'D3'],
  ['FL Piano (21).wav', 297.97, 'D4'],
  ['FL Piano (22).wav', 595.95, 'D5'],
  ['FL Piano (23).wav', 1191.89, 'D6'],
  ['FL Piano (24).wav', 1191.89, 'D6'],
  ['FL Piano (25).wav', 41.41, 'E1'],
  ['FL Piano (26).wav', 83.05, 'E2'],
  ['FL Piano (27).wav', 165.17, 'E3'],
  ['FL Piano (28).wav', 334.09, 'E4'],
  ['FL Piano (29).wav', 668.18, 'E5'],
  ['FL Piano (30).wav', 1336.36, 'E6'],
  ['FL Piano (31).wav', 1336.36, 'E6'],
  ['FL Piano (32).wav', 46.47, 'F#1'],
  ['FL Piano (33).wav', 92.65, 'F#2'],
  ['FL Piano (34).wav', 186.08, 'F#3'],
  ['FL Piano (35).wav', 370.59, 'F#4'],
  ['FL Piano (36).wav', 760.34, 'F#5'],
  ['FL Piano (37).wav', 1470.0, 'F#6'],
  ['FL Piano (38).wav', 1470.0, 'F#6'],
  ['FL Piano (39).wav', 52.07, 'G#1'],
  ['FL Piano (40).wav', 104.5, 'G#2'],
  ['FL Piano (41).wav', 210.0, 'G#3'],
  ['FL Piano (42).wav', 416.04, 'G#4'],
  ['FL Piano (43).wav', 848.08, 'G#5'],
  ['FL Piano (44).wav', 1633.33, 'G#6'],
  ['FL Piano (45).wav', 832.08, 'G#5'],
];

const DEFAULT_SAMPLE_MAP = new Map(
  DEFAULT_PIANO_SAMPLE_ROWS.map(([fileName, baseFrequency, noteLabel]) => [fileName, {baseFrequency, noteLabel}]),
);

function getNumericSampleOrder(fileName: string): number {
  const match = fileName.match(/\((\d+)\)\.wav$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

const SAMPLE_CATALOG: PianoSampleDefinition[] = Object.entries(sampleUrls)
  .map(([path, url]) => {
    const fileName = path.split('/').pop();
    if (!fileName) {
      return null;
    }

    const analyzed = DEFAULT_SAMPLE_MAP.get(fileName);
    if (!analyzed) {
      return null;
    }

    return {
      id: fileName,
      fileName,
      url,
      baseFrequency: analyzed.baseFrequency,
      referenceFrequency: analyzed.baseFrequency,
      noteLabel: analyzed.noteLabel,
    };
  })
  .filter((sample): sample is PianoSampleDefinition => sample !== null)
  .sort((a, b) => getNumericSampleOrder(a.fileName) - getNumericSampleOrder(b.fileName));

let activePianoSamples: PianoSampleDefinition[] = SAMPLE_CATALOG.map((sample) => ({...sample}));

function getPitchFrequencyByReference(tuning: TuningPreset, pitchId: number, octaveShift: number): {baseFrequency: number; noteLabel: string} | null {
  const {pitchDef, octaveShift: resolvedShift} = resolvePitch(encodePitchReference(pitchId, octaveShift), tuning);
  if (!pitchDef) {
    return null;
  }

  return {
    baseFrequency: calculateFrequency(pitchDef, tuning, resolvedShift),
    noteLabel: getFormattedPitchLabel(pitchDef, tuning, 'note', resolvedShift),
  };
}

export function findClosestPitchReferenceForFrequency(
  targetFrequency: number,
  tuning: TuningPreset,
): {pitchId: number; octaveShift: number; baseFrequency: number; noteLabel: string} | null {
  if (!Number.isFinite(targetFrequency) || targetFrequency <= 0 || tuning.pitches.length === 0) {
    return null;
  }

  let nearest: {pitchId: number; octaveShift: number; baseFrequency: number; noteLabel: string} | null = null;
  let nearestDistance = Infinity;

  for (const pitch of tuning.pitches) {
    for (let octaveShift = DEFAULT_OCTAVE_SEARCH_MIN; octaveShift <= DEFAULT_OCTAVE_SEARCH_MAX; octaveShift += 1) {
      const resolved = getPitchFrequencyByReference(tuning, pitch.id, octaveShift);
      if (!resolved || resolved.baseFrequency <= 0) {
        continue;
      }
      const distance = Math.abs(Math.log2(targetFrequency / resolved.baseFrequency));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = {
          pitchId: pitch.id,
          octaveShift,
          baseFrequency: resolved.baseFrequency,
          noteLabel: resolved.noteLabel,
        };
      }
    }
  }

  return nearest;
}

function resolveSampleDefinition(
  sample: PianoSampleDefinition,
  tuning: TuningPreset,
  overrides?: PianoSampleOverrideMap,
): PianoSampleDefinition {
  const override = overrides?.[sample.fileName];

  if (override?.pitchId !== undefined) {
    const resolved = getPitchFrequencyByReference(tuning, override.pitchId, override.octaveShift ?? 0);
    if (resolved) {
      return {
        ...sample,
        pitchId: override.pitchId,
        octaveShift: override.octaveShift ?? 0,
        referenceFrequency: resolved.baseFrequency,
        noteLabel: resolved.noteLabel,
      };
    }
  }

  const guessed = findClosestPitchReferenceForFrequency(override?.baseFrequency ?? sample.baseFrequency, tuning);
  if (guessed) {
    return {
      ...sample,
      pitchId: guessed.pitchId,
      octaveShift: guessed.octaveShift,
      referenceFrequency: guessed.baseFrequency,
      noteLabel: guessed.noteLabel,
    };
  }

  return {
    ...sample,
    referenceFrequency: override?.baseFrequency ?? sample.baseFrequency,
    noteLabel: override?.noteLabel ?? sample.noteLabel,
  };
}

export function buildPianoSamples(tuning: TuningPreset, overrides?: PianoSampleOverrideMap): PianoSampleDefinition[] {
  return SAMPLE_CATALOG
    .map((sample) => resolveSampleDefinition(sample, tuning, overrides))
    .sort((a, b) => a.referenceFrequency - b.referenceFrequency);
}

export function setPianoSampleOverrides(tuning: TuningPreset, overrides?: PianoSampleOverrideMap) {
  activePianoSamples = buildPianoSamples(tuning, overrides);
}

export function getPianoSampleCatalog(): PianoSampleDefinition[] {
  return SAMPLE_CATALOG.map((sample) => ({...sample}));
}

export function getActivePianoSamples(): PianoSampleDefinition[] {
  return activePianoSamples.map((sample) => ({...sample}));
}

export function getDefaultPianoSampleOverrideMap(tuning: TuningPreset): PianoSampleOverrideMap {
  return Object.fromEntries(
    SAMPLE_CATALOG.map((sample) => {
      const guessed = findClosestPitchReferenceForFrequency(sample.baseFrequency, tuning);
      return [
        sample.fileName,
        guessed
          ? {pitchId: guessed.pitchId, octaveShift: guessed.octaveShift}
          : {baseFrequency: sample.baseFrequency, noteLabel: sample.noteLabel},
      ];
    }),
  );
}

export function findNearestPianoSample(targetFrequency: number): PianoSampleDefinition | null {
  if (!activePianoSamples.length || targetFrequency <= 0) {
    return null;
  }

  let nearest = activePianoSamples[0];
  let nearestDistance = Infinity;

  for (const sample of activePianoSamples) {
    const distance = Math.abs(Math.log2(targetFrequency / sample.referenceFrequency));
    if (distance < nearestDistance) {
      nearest = sample;
      nearestDistance = distance;
    }
  }

  return nearest;
}
