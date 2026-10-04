import {LayoutPreset, PitchDefinition, TuningPreset} from '../types/keyboard';
import {isValidFrequencyValue, resolvePitch} from './pitch';

export type ValidationResult =
  | {ok: true}
  | {ok: false; error: string};

export type PresetImportResult =
  | {ok: true; kind: 'layout'; layout: LayoutPreset}
  | {ok: true; kind: 'tuning'; tuning: TuningPreset}
  | {ok: true; kind: 'package'; layout: LayoutPreset; tuning?: TuningPreset}
  | {ok: false; error: string};

const PITCH_TYPES = new Set(['edo', 'cents', 'ratio', 'frequency']);
const INVALID_SECTION_MODES = new Set(['fixed', 'compressed', 'custom']);

function fail(error: string): ValidationResult {
  return {ok: false, error};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateBoundaries(
  value: unknown,
  expectedLength: number,
  field: string,
): ValidationResult {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    return fail(`${field} must contain exactly ${expectedLength} values`);
  }
  if (!value.every(isFiniteNumber)) {
    return fail(`${field} must contain only finite numbers`);
  }
  if (value[0] !== 0 || value[value.length - 1] !== 1) {
    return fail(`${field} must start at 0 and end at 1`);
  }
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] < 0 || value[index] > 1 || value[index] < value[index - 1]) {
      return fail(`${field} must be monotonic within 0..1`);
    }
  }
  return {ok: true};
}

function validateBoundaryTemplateMap(
  value: unknown,
  field: string,
  options: {required: boolean},
): ValidationResult {
  const {required} = options;
  if (value === undefined && !required) {
    return {ok: true};
  }
  if (!isRecord(value)) {
    return fail(`${field} must be an object`);
  }

  for (const [rawDepth, boundaries] of Object.entries(value)) {
    const depth = Number(rawDepth);
    if (!Number.isInteger(depth) || depth < 1 || depth > 8) {
      return fail(`${field} contains an unsupported depth key`);
    }
    const result = validateBoundaries(boundaries, depth + 1, `${field}[${rawDepth}]`);
    if (!result.ok) {
      return result;
    }
  }
  return {ok: true};
}

function validatePitch(pitch: unknown, index: number): ValidationResult {
  if (!isRecord(pitch)) {
    return fail(`pitches[${index}] must be an object`);
  }
  if (!isSafeInteger(pitch.id) || pitch.id < 0 || pitch.id > 255) {
    return fail(`pitches[${index}].id must be an integer in 0..255`);
  }
  if (typeof pitch.name !== 'string') {
    return fail(`pitches[${index}].name must be a string`);
  }
  if (typeof pitch.type !== 'string' || !PITCH_TYPES.has(pitch.type)) {
    return fail(`pitches[${index}].type is unsupported`);
  }

  switch (pitch.type) {
    case 'edo':
      if (!isSafeInteger(pitch.edo) || pitch.edo <= 0) {
        return fail(`pitches[${index}].edo must be a positive integer`);
      }
      if (!isSafeInteger(pitch.step)) {
        return fail(`pitches[${index}].step must be an integer`);
      }
      break;
    case 'cents':
      if (!isFiniteNumber(pitch.cents)) {
        return fail(`pitches[${index}].cents must be finite`);
      }
      break;
    case 'ratio':
      if (!isSafeInteger(pitch.numerator) || pitch.numerator <= 0) {
        return fail(`pitches[${index}].numerator must be a positive integer`);
      }
      if (!isSafeInteger(pitch.denominator) || pitch.denominator <= 0) {
        return fail(`pitches[${index}].denominator must be a positive integer`);
      }
      break;
    case 'frequency':
      if (!isValidFrequencyValue(pitch.frequency)) {
        return fail(`pitches[${index}].frequency must be finite and > 0`);
      }
      break;
  }

  return {ok: true};
}

export function validateTuningPresetData(data: unknown): ValidationResult {
  if (!isRecord(data)) {
    return fail('tuning preset must be an object');
  }
  if (!isNonEmptyString(data.id) || !isNonEmptyString(data.name)) {
    return fail('tuning preset id/name must be non-empty strings');
  }
  if (!isFiniteNumber(data.periodCents) || data.periodCents <= 0) {
    return fail('periodCents must be a positive finite number');
  }
  if (!isSafeInteger(data.baseAddress) || data.baseAddress < 0 || data.baseAddress > 255) {
    return fail('baseAddress must be an integer in 0..255');
  }
  if (!isFiniteNumber(data.baseFrequency) || data.baseFrequency <= 0) {
    return fail('baseFrequency must be a positive finite number');
  }
  if (data.baseStep !== undefined && !isSafeInteger(data.baseStep)) {
    return fail('baseStep must be an integer when present');
  }
  if (!Array.isArray(data.pitches)) {
    return fail('pitches must be an array');
  }

  const ids = new Set<number>();
  for (let index = 0; index < data.pitches.length; index += 1) {
    const pitch = data.pitches[index];
    const result = validatePitch(pitch, index);
    if (!result.ok) {
      return result;
    }
    const id = (pitch as PitchDefinition).id;
    if (ids.has(id)) {
      return fail(`duplicate pitch id: ${id}`);
    }
    ids.add(id);
  }

  for (const field of ['noteNames', 'doremiNames'] as const) {
    const value = data[field];
    if (value !== undefined && (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))) {
      return fail(`${field} must be an array of strings when present`);
    }
  }

  return {ok: true};
}

export function validateLayoutPresetData(data: unknown): ValidationResult {
  if (!isRecord(data)) {
    return fail('layout preset must be an object');
  }
  if (!isNonEmptyString(data.id) || !isNonEmptyString(data.name)) {
    return fail('layout preset id/name must be non-empty strings');
  }
  if (data.defaultTuningId !== undefined && typeof data.defaultTuningId !== 'string') {
    return fail('defaultTuningId must be a string when present');
  }
  if (
    data.horizontalCount !== undefined
    && (!isSafeInteger(data.horizontalCount) || data.horizontalCount < 1 || data.horizontalCount > 16)
  ) {
    return fail('horizontalCount must be an integer in 1..16 when present');
  }
  if (!Array.isArray(data.lanes) || data.lanes.length !== 32) {
    return fail('lanes must contain exactly 32 lane records');
  }

  for (let index = 0; index < data.lanes.length; index += 1) {
    const lane = data.lanes[index];
    if (!isRecord(lane)) {
      return fail(`lanes[${index}] must be an object`);
    }
    if (!isSafeInteger(lane.activeDepths) || lane.activeDepths < 0 || lane.activeDepths > 8) {
      return fail(`lanes[${index}].activeDepths must be an integer in 0..8`);
    }
    if (lane.customBoundaries !== undefined) {
      const expectedLength = lane.activeDepths > 0 ? lane.activeDepths + 1 : 2;
      const result = validateBoundaries(
        lane.customBoundaries,
        expectedLength,
        `lanes[${index}].customBoundaries`,
      );
      if (!result.ok) {
        return result;
      }
    }
  }

  if (!Array.isArray(data.mapping) || data.mapping.length !== 256) {
    return fail('mapping must contain exactly 256 pitch references');
  }
  for (let index = 0; index < data.mapping.length; index += 1) {
    if (!isSafeInteger(data.mapping[index])) {
      return fail(`mapping[${index}] must be an integer pitch reference`);
    }
  }

  if (
    data.slotFlags !== undefined
    && (!Array.isArray(data.slotFlags)
      || data.slotFlags.length !== 256
      || !data.slotFlags.every((value) => typeof value === 'boolean'))
  ) {
    return fail('slotFlags must contain exactly 256 booleans when present');
  }

  const primary = validateBoundaryTemplateMap(
    data.boundaryTemplates,
    'boundaryTemplates',
    {required: true},
  );
  if (!primary.ok) {
    return primary;
  }
  for (const field of ['whiteBoundaryTemplates', 'blackBoundaryTemplates'] as const) {
    const result = validateBoundaryTemplateMap(data[field], field, {required: false});
    if (!result.ok) {
      return result;
    }
  }

  if (typeof data.invalidSectionMode !== 'string' || !INVALID_SECTION_MODES.has(data.invalidSectionMode)) {
    return fail('invalidSectionMode is unsupported');
  }

  return {ok: true};
}

export function validateLayoutForTuning(
  layout: LayoutPreset,
  tuning: TuningPreset,
): ValidationResult {
  for (let index = 0; index < layout.mapping.length; index += 1) {
    const pitchRef = layout.mapping[index];
    if (pitchRef === -1) {
      continue;
    }
    if (!resolvePitch(pitchRef, tuning).pitchDef) {
      return fail(`mapping[${index}] cannot be resolved by tuning ${tuning.id}`);
    }
  }
  return {ok: true};
}

export function validatePresetImport(
  data: unknown,
  activeTuning: TuningPreset,
): PresetImportResult {
  if (!isRecord(data)) {
    return {ok: false, error: '読み込んだデータはオブジェクトではありません。'};
  }

  const wrapped = 'layoutPreset' in data || 'tuningPreset' in data;
  if (wrapped) {
    if (!('layoutPreset' in data)) {
      return {ok: false, error: 'パッケージにlayoutPresetがありません。'};
    }

    const layoutResult = validateLayoutPresetData(data.layoutPreset);
    if ('error' in layoutResult) {
      return {ok: false, error: `配置プリセットが不正です: ${layoutResult.error}`};
    }

    let tuning: TuningPreset | undefined;
    if ('tuningPreset' in data && data.tuningPreset !== undefined) {
      const tuningResult = validateTuningPresetData(data.tuningPreset);
      if ('error' in tuningResult) {
        return {ok: false, error: `音高プリセットが不正です: ${tuningResult.error}`};
      }
      tuning = data.tuningPreset as TuningPreset;
    }

    const layout = data.layoutPreset as LayoutPreset;
    const compatibility = validateLayoutForTuning(layout, tuning ?? activeTuning);
    if ('error' in compatibility) {
      return {ok: false, error: `配置と音高の組合せが不正です: ${compatibility.error}`};
    }
    return {ok: true, kind: 'package', layout, tuning};
  }

  if ('lanes' in data || 'mapping' in data) {
    const layoutResult = validateLayoutPresetData(data);
    if ('error' in layoutResult) {
      return {ok: false, error: `配置プリセットが不正です: ${layoutResult.error}`};
    }
    const layout = data as unknown as LayoutPreset;
    const compatibility = validateLayoutForTuning(layout, activeTuning);
    if ('error' in compatibility) {
      return {ok: false, error: `配置と現在の音高の組合せが不正です: ${compatibility.error}`};
    }
    return {ok: true, kind: 'layout', layout};
  }

  if ('pitches' in data) {
    const tuningResult = validateTuningPresetData(data);
    if ('error' in tuningResult) {
      return {ok: false, error: `音高プリセットが不正です: ${tuningResult.error}`};
    }
    return {ok: true, kind: 'tuning', tuning: data as unknown as TuningPreset};
  }

  return {ok: false, error: '読み込めるプリセット形式ではありません。'};
}
