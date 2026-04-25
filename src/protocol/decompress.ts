import { decompress as zstdDecompress } from 'fzstd';
import { decompress as lz4Decompress } from 'lz4js';
import { TerrainCompression, type TerrainCompressionValue } from './types';

const ALGORITHM_NAME: Record<TerrainCompressionValue, string> = {
  [TerrainCompression.NONE]: 'none',
  [TerrainCompression.ZSTD]: 'zstd',
  [TerrainCompression.LZ4]: 'lz4',
};

/**
 * Decompresses a terrain payload according to the wire-protocol algorithm tag.
 * For NONE the input is returned unchanged (caller owns lifetime). On decoder
 * failure a TypeError is thrown with the algorithm name in the message.
 */
export function decompress(
  payload: Uint8Array,
  algorithm: TerrainCompressionValue,
): Uint8Array {
  if (algorithm === TerrainCompression.NONE) {
    return payload;
  }
  try {
    if (algorithm === TerrainCompression.ZSTD) {
      return zstdDecompress(payload);
    }
    if (algorithm === TerrainCompression.LZ4) {
      return lz4Decompress(payload);
    }
  } catch (err) {
    const name = ALGORITHM_NAME[algorithm];
    const message = err instanceof Error ? err.message : String(err);
    throw new TypeError(`terrain decompress: ${name} failed: ${message}`);
  }
  // Exhaustiveness: every value of TerrainCompressionValue is handled above.
  const exhaustive: never = algorithm;
  throw new TypeError(`terrain decompress: unknown algorithm ${String(exhaustive)}`);
}
