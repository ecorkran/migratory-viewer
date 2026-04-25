declare module 'lz4js' {
  /** Decompress an LZ4 Frame-format buffer. */
  export function decompress(src: Uint8Array, maxSize?: number): Uint8Array;
}
