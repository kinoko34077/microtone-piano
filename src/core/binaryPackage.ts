/**
 * Portable preset archive codec. The legacy .bin format contained plain UTF-8 JSON.
 * v1 is an MMPK header followed by a losslessly gzip-compressed UTF-8 JSON document.
 * Schema validation and admission remain owned by presetValidation.ts.
 *
 * Spec/owner: microtone-piano#34 (DATA-002/003/004, LIMIT-001).
 */
const MAGIC = [0x4d, 0x4d, 0x50, 0x4b] as const; // "MMPK"
const HEADER_BYTES = 12;
const CODEC_VERSION = 1;
const GZIP_CODEC = 1;
const MIB = 1024 * 1024;

export const MAX_COMPRESSED_PRESET_BYTES = 32 * MIB;
export const MAX_JSON_PRESET_BYTES = 64 * MIB;

function hasMagic(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC.length && MAGIC.every((value, index) => bytes[index] === value);
}

function parseJson(bytes: Uint8Array): unknown {
  // Strict UTF-8: malformed old .bin files must not silently change characters.
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}

export async function encodeCompressedPreset(data: unknown): Promise<Uint8Array> {
  const json = JSON.stringify(data);
  if (typeof json !== 'string') {
    throw new Error('書き出すプリセットデータがありません。');
  }
  const uncompressed = new TextEncoder().encode(json);
  if (uncompressed.byteLength > MAX_JSON_PRESET_BYTES) {
    throw new Error('プリセットの展開前サイズが64MiBを超えています。');
  }
  if (typeof CompressionStream === 'undefined') {
    throw new Error('このブラウザはgzip圧縮に対応していません。JSON形式で書き出してください。');
  }

  const compressed = new Uint8Array(
    await new Response(
      new Blob([uncompressed]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  );
  if (compressed.byteLength > MAX_COMPRESSED_PRESET_BYTES) {
    throw new Error('圧縮後のプリセットが32MiBを超えています。');
  }

  const result = new Uint8Array(HEADER_BYTES + compressed.byteLength);
  result.set(MAGIC);
  result[4] = CODEC_VERSION;
  result[5] = GZIP_CODEC;
  // result[6..7] are reserved zero bytes.
  new DataView(result.buffer).setUint32(8, uncompressed.byteLength, true);
  result.set(compressed, HEADER_BYTES);
  return result;
}

/**
 * Read new gzip BIN and legacy JSON / UTF-8 JSON BIN by content, not extension.
 * The entire decoded document is bounded during streaming before JSON.parse.
 */
export async function decodePresetBytes(bytes: Uint8Array): Promise<unknown> {
  if (!hasMagic(bytes)) {
    if (bytes.byteLength > MAX_JSON_PRESET_BYTES) {
      throw new Error('旧形式のプリセットファイルが64MiBを超えています。');
    }
    return parseJson(bytes);
  }

  if (bytes.byteLength < HEADER_BYTES) {
    throw new Error('圧縮BINのヘッダーが途中で切れています。');
  }
  if (bytes.byteLength - HEADER_BYTES > MAX_COMPRESSED_PRESET_BYTES) {
    throw new Error('圧縮BINが32MiBを超えています。');
  }
  if (bytes[4] !== CODEC_VERSION || bytes[5] !== GZIP_CODEC || bytes[6] !== 0 || bytes[7] !== 0) {
    throw new Error('未対応または不正な圧縮BINのヘッダーです。');
  }
  const expectedSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  if (expectedSize > MAX_JSON_PRESET_BYTES) {
    throw new Error('圧縮BINの展開後サイズが64MiBを超えています。');
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('このブラウザはgzip展開に対応していません。');
  }

  const reader = new Blob([bytes.subarray(HEADER_BYTES)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_JSON_PRESET_BYTES || length > expectedSize) {
        await reader.cancel().catch(() => undefined);
        throw new Error('圧縮BINの展開結果が宣言されたサイズを超えています。');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('圧縮BINの展開結果が')) throw error;
    throw new Error('gzipデータが破損しているか、展開できません。');
  }
  if (length !== expectedSize) {
    throw new Error('圧縮BINの展開後サイズがヘッダーと一致しません。');
  }
  const uncompressed = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    uncompressed.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return parseJson(uncompressed);
}
