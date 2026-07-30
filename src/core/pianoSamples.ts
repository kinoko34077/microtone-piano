import {TuningPreset} from '../types/keyboard';
import {calculateFrequency, encodePitchReference, getFormattedPitchLabel, resolvePitch} from './pitch';

export type PianoSampleRow = [fileName: string, noteLabel: string, baseFrequency?: number];

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

export type PianoSampleOverrideMap = Record<
  string,
  {pitchId?: number; octaveShift?: number; baseFrequency?: number; noteLabel?: string}
>;

const DEFAULT_OCTAVE_SEARCH_MIN = -8;
const DEFAULT_OCTAVE_SEARCH_MAX = 8;
const NOTE_INDEX: Record<string, number> = {
  C: 0,
  'C#': 1,
  DB: 1,
  D: 2,
  'D#': 3,
  EB: 3,
  E: 4,
  F: 5,
  'F#': 6,
  GB: 6,
  G: 7,
  'G#': 8,
  AB: 8,
  A: 9,
  'A#': 10,
  BB: 10,
  B: 11,
};

const sampleUrls = import.meta.glob('../../Grandpiano \\(m4a\\)/*.m4a', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>;

export const DEFAULT_PIANO_SAMPLE_ROWS: PianoSampleRow[] = [
  ['FL Piano (1).wav', 'A1'],
  ['FL Piano (2).wav', 'A#1'],
  ['FL Piano (10).wav', 'C2'],
  ['FL Piano (18).wav', 'D2'],
  ['FL Piano (25).wav', 'E2'],
  ['FL Piano (32).wav', 'F#2'],
  ['FL Piano (39).wav', 'G#2'],
  ['FL Piano (3).wav', 'A#2'],
  ['FL Piano (11).wav', 'C3'],
  ['FL Piano (19).wav', 'D3'],
  ['FL Piano (26).wav', 'E3'],
  ['FL Piano (33).wav', 'F#3'],
  ['FL Piano (40).wav', 'G#3'],
  ['FL Piano (4).wav', 'A#3'],
  ['FL Piano (12).wav', 'C4'],
  ['FL Piano (20).wav', 'D4'],
  ['FL Piano (27).wav', 'E4'],
  ['FL Piano (34).wav', 'F#4'],
  ['FL Piano (41).wav', 'G#4'],
  ['FL Piano (5).wav', 'A#4'],
  ['FL Piano (13).wav', 'C5'],
  ['FL Piano (21).wav', 'D5'],
  ['FL Piano (28).wav', 'E5'],
  ['FL Piano (35).wav', 'F#5'],
  ['FL Piano (42).wav', 'G#5'],
  ['FL Piano (6).wav', 'A#5'],
  ['FL Piano (14).wav', 'C6'],
  ['FL Piano (22).wav', 'D6'],
  ['FL Piano (29).wav', 'E6'],
  ['FL Piano (36).wav', 'F#6'],
  ['FL Piano (43).wav', 'G#6'],
  ['FL Piano (7).wav', 'A#6'],
  ['FL Piano (15).wav', 'C7'],
  ['FL Piano (23).wav', 'D7'],
  ['FL Piano (30).wav', 'E7'],
  ['FL Piano (37).wav', 'F#7'],
  ['FL Piano (44).wav', 'G#7'],
  ['FL Piano (8).wav', 'A#7'],
  ['FL Piano (16).wav', 'C8'],
  ['FL Piano (24).wav', 'D8'],
  ['FL Piano (31).wav', 'E8'],
  ['FL Piano (38).wav', 'F#8'],
  ['FL Piano (45).wav', 'G#8'],
  ['FL Piano (9).wav', 'A#8'],
  ['FL Piano (17).wav', 'C9'],
];

export function getEqualTemperamentFrequency(noteLabel: string): number | null {
  const normalized = noteLabel.trim().toUpperCase().replace('♯', '#').replace('＃', '#').replace('♭', 'B');
  const match = normalized.match(/^([A-G](?:#|B)?)(-?\d+)$/);
  if (!match) {
    return null;
  }

  const noteIndex = NOTE_INDEX[match[1]];
  const octave = Number(match[2]);
  if (noteIndex === undefined || !Number.isFinite(octave)) {
    return null;
  }

  const midiNumber = (octave + 1) * 12 + noteIndex;
  return 440 * Math.pow(2, (midiNumber - 69) / 12);
}

function getSampleBaseFrequency(noteLabel: string, explicitFrequency?: number): number {
  if (explicitFrequency !== undefined && Number.isFinite(explicitFrequency) && explicitFrequency > 0) {
    return explicitFrequency;
  }
  return getEqualTemperamentFrequency(noteLabel) ?? 440;
}

const DEFAULT_SAMPLE_MAP = new Map(
  DEFAULT_PIANO_SAMPLE_ROWS.map(([fileName, noteLabel, baseFrequency]) => [
    fileName,
    {baseFrequency: getSampleBaseFrequency(noteLabel, baseFrequency), noteLabel},
  ]),
);

function getNumericSampleOrder(fileName: string): number {
  const match = fileName.match(/\((\d+)\)\.(?:wav|m4a)$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

const SAMPLE_URL_BY_WAV_NAME = new Map(
  Object.entries(sampleUrls).map(([path, url]) => {
    const sourceFileName = path.split('/').pop() ?? '';
    return [sourceFileName.replace(/\.m4a$/i, '.wav'), url];
  }),
);

const SAMPLE_CATALOG: PianoSampleDefinition[] = DEFAULT_PIANO_SAMPLE_ROWS
  .map(([fileName]) => {
    const url = SAMPLE_URL_BY_WAV_NAME.get(fileName);
    const sampleInfo = DEFAULT_SAMPLE_MAP.get(fileName);
    if (!url || !sampleInfo) {
      return null;
    }

    return {
      id: fileName,
      fileName,
      url,
      baseFrequency: sampleInfo.baseFrequency,
      referenceFrequency: sampleInfo.baseFrequency,
      noteLabel: sampleInfo.noteLabel,
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

function getOverrideBaseFrequency(sample: PianoSampleDefinition, override?: PianoSampleOverrideMap[string]): {frequency: number; noteLabel: string} {
  const noteLabel = override?.noteLabel?.trim() || sample.noteLabel;
  return {
    frequency: getSampleBaseFrequency(noteLabel, override?.baseFrequency),
    noteLabel,
  };
}

function resolveSampleDefinition(
  sample: PianoSampleDefinition,
  tuning: TuningPreset,
  overrides?: PianoSampleOverrideMap,
): PianoSampleDefinition {
  const override = overrides?.[sample.fileName];
  const sampleBase = getOverrideBaseFrequency(sample, override);

  if (override?.pitchId !== undefined) {
    const resolved = getPitchFrequencyByReference(tuning, override.pitchId, override.octaveShift ?? 0);
    if (resolved) {
      return {
        ...sample,
        baseFrequency: sampleBase.frequency,
        pitchId: override.pitchId,
        octaveShift: override.octaveShift ?? 0,
        referenceFrequency: sampleBase.frequency,
        noteLabel: sampleBase.noteLabel,
      };
    }
  }

  const guessed = findClosestPitchReferenceForFrequency(sampleBase.frequency, tuning);
  if (guessed) {
    return {
      ...sample,
      baseFrequency: sampleBase.frequency,
      pitchId: guessed.pitchId,
      octaveShift: guessed.octaveShift,
      referenceFrequency: sampleBase.frequency,
      noteLabel: sampleBase.noteLabel,
    };
  }

  return {
    ...sample,
    baseFrequency: sampleBase.frequency,
    referenceFrequency: sampleBase.frequency,
    noteLabel: sampleBase.noteLabel,
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
          ? {pitchId: guessed.pitchId, octaveShift: guessed.octaveShift, noteLabel: sample.noteLabel}
          : {noteLabel: sample.noteLabel},
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
