import { describe, expect, it } from 'vitest';
import { decompress } from './decompress';
import { TerrainCompression } from './types';

// Plaintext: four f32 LE values [0, 1, 2, 3] = the spec's worked-example payload.
// 16 bytes: 00000000 0000803f 00000040 00004040
const PLAINTEXT_F32_0123 = Uint8Array.of(
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x80, 0x3f,
  0x00, 0x00, 0x00, 0x40,
  0x00, 0x00, 0x40, 0x40,
);

// Generated via: zstd -f -19 elev_2x2.bin (where elev_2x2.bin is the 16 plaintext bytes above).
const ZSTD_FRAME_0123 = Uint8Array.of(
  0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x10, 0x81, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80,
  0x3f, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x40,
  0x40, 0x4f, 0xc6, 0xae, 0x49,
);

// Generated via: lz4 -f --no-frame-crc elev_2x2.bin (LZ4 Frame format, no
// content-size flag — lz4js's decompressBound mishandles the 64-bit content-size
// field, so we use frames without it. The frame is still RFC-compliant.)
const LZ4_FRAME_0123 = Uint8Array.of(
  0x04, 0x22, 0x4d, 0x18, 0x60, 0x40, 0x82, 0x0f,
  0x00, 0x00, 0x00, 0x11, 0x00, 0x01, 0x00, 0xa0,
  0x80, 0x3f, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00,
  0x40, 0x40, 0x00, 0x00, 0x00, 0x00,
);

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('decompress', () => {
  it('NONE returns the input unchanged', () => {
    const input = Uint8Array.of(1, 2, 3, 4, 5);
    const out = decompress(input, TerrainCompression.NONE);
    expect(out).toBe(input);
    expect(out.length).toBe(5);
  });

  it('ZSTD decodes the spec worked-example frame', () => {
    const out = decompress(ZSTD_FRAME_0123, TerrainCompression.ZSTD);
    expect(bytesEqual(out, PLAINTEXT_F32_0123)).toBe(true);
  });

  it('LZ4 decodes a frame-format fixture', () => {
    const out = decompress(LZ4_FRAME_0123, TerrainCompression.LZ4);
    expect(bytesEqual(out, PLAINTEXT_F32_0123)).toBe(true);
  });

  it('wraps decoder failures in a TypeError prefixed with the algorithm', () => {
    const garbage = Uint8Array.of(0xff, 0xff, 0xff, 0xff);
    expect(() => decompress(garbage, TerrainCompression.ZSTD)).toThrow(
      /^terrain decompress: zstd failed:/,
    );
  });
});
