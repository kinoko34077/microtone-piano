type PianoSampleRow = [fileName: string, baseFrequency: number, noteLabel: string];

export interface PianoSampleDefinition {
  id: string;
  fileName: string;
  url: string;
  baseFrequency: number;
  noteLabel: string;
}

const sampleUrls = import.meta.glob('../../Grand Piano/*.wav', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const analyzedSampleRows: PianoSampleRow[] = [
  ['FL Piano (1).wav', 55.0, 'A1'],
  ['FL Piano (2).wav', 58.0, 'A#1'],
  ['FL Piano (3).wav', 58.33, 'A#1'],
  ['FL Piano (4).wav', 116.74, 'A#2'],
  ['FL Piano (5).wav', 234.41, 'A#3'],
  ['FL Piano (6).wav', 469.85, 'A#4'],
  ['FL Piano (7).wav', 945.6, 'A#5'],
  ['FL Piano (8).wav', 938.3, 'A#5'],
  ['FL Piano (9).wav', 938.3, 'A#5'],
  ['FL Piano (10).wav', 65.5, 'C2'],
  ['FL Piano (11).wav', 65.82, 'C2'],
  ['FL Piano (12).wav', 131.32, 'C3'],
  ['FL Piano (13).wav', 262.79, 'C4'],
  ['FL Piano (14).wav', 527.16, 'C5'],
  ['FL Piano (15).wav', 1048.0, 'C6'],
  ['FL Piano (16).wav', 1050.0, 'C6'],
  ['FL Piano (17).wav', 1050.0, 'C6'],
  ['FL Piano (18).wav', 36.78, 'D1'],
  ['FL Piano (19).wav', 73.87, 'D2'],
  ['FL Piano (20).wav', 147.12, 'D3'],
  ['FL Piano (21).wav', 296.75, 'D4'],
  ['FL Piano (22).wav', 591.22, 'D5'],
  ['FL Piano (23).wav', 1182.74, 'D6'],
  ['FL Piano (24).wav', 1191.89, 'D6'],
  ['FL Piano (25).wav', 41.45, 'E1'],
  ['FL Piano (26).wav', 83.03, 'E2'],
  ['FL Piano (27).wav', 165.08, 'E3'],
  ['FL Piano (28).wav', 333.07, 'E4'],
  ['FL Piano (29).wav', 663.59, 'E5'],
  ['FL Piano (30).wav', 658.21, 'E5'],
  ['FL Piano (31).wav', 658.21, 'E5'],
  ['FL Piano (32).wav', 46.52, 'F#1'],
  ['FL Piano (33).wav', 92.57, 'F#2'],
  ['FL Piano (34).wav', 185.54, 'F#3'],
  ['FL Piano (35).wav', 370.29, 'F#4'],
  ['FL Piano (36).wav', 750.17, 'F#5'],
  ['FL Piano (37).wav', 370.59, 'F#4'],
  ['FL Piano (38).wav', 735.0, 'F#5'],
  ['FL Piano (39).wav', 52.07, 'G#1'],
  ['FL Piano (40).wav', 104.0, 'G#2'],
  ['FL Piano (41).wav', 208.75, 'G#3'],
  ['FL Piano (42).wav', 415.52, 'G#4'],
  ['FL Piano (43).wav', 839.29, 'G#5'],
  ['FL Piano (44).wav', 832.08, 'G#5'],
  ['FL Piano (45).wav', 832.08, 'G#5'],
];

const analyzedSampleMap = new Map(
  analyzedSampleRows.map(([fileName, baseFrequency, noteLabel]) => [fileName, {baseFrequency, noteLabel}])
);

export const PIANO_SAMPLES: PianoSampleDefinition[] = Object.entries(sampleUrls)
  .map(([path, url]) => {
    const fileName = path.split('/').pop();
    if (!fileName) {
      return null;
    }

    const analyzed = analyzedSampleMap.get(fileName);
    if (!analyzed) {
      return null;
    }

    return {
      id: fileName,
      fileName,
      url,
      baseFrequency: analyzed.baseFrequency,
      noteLabel: analyzed.noteLabel,
    };
  })
  .filter((sample): sample is PianoSampleDefinition => sample !== null)
  .sort((a, b) => a.baseFrequency - b.baseFrequency);

export function findNearestPianoSample(targetFrequency: number): PianoSampleDefinition | null {
  if (!PIANO_SAMPLES.length || targetFrequency <= 0) {
    return null;
  }

  let nearest = PIANO_SAMPLES[0];
  let nearestDistance = Infinity;

  for (const sample of PIANO_SAMPLES) {
    const distance = Math.abs(Math.log2(targetFrequency / sample.baseFrequency));
    if (distance < nearestDistance) {
      nearest = sample;
      nearestDistance = distance;
    }
  }

  return nearest;
}
