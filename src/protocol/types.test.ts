import { describe, it, expect } from 'vitest';
import { MessageType, TerrainCompression, TerrainDtype } from './types';

describe('protocol constants', () => {
  it('MessageType pins every opcode byte', () => {
    expect(MessageType).toEqual({
      SNAPSHOT: 0x01,
      STATE_UPDATE: 0x02,
      TERRAIN: 0x03,
      TERRAIN_CHUNK: 0x04,
      TERRAIN_HEADER: 0x05,
    });
  });

  it('TerrainDtype pins low-2-bit dtype encoding', () => {
    expect(TerrainDtype).toEqual({
      F32: 0,
      F64: 1,
      UINT16: 2,
    });
  });

  it('TerrainCompression pins compression encoding', () => {
    expect(TerrainCompression).toEqual({
      NONE: 0,
      ZSTD: 1,
      LZ4: 2,
    });
  });
});
