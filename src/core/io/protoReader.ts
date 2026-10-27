// Minimal protobuf wire format reader (no code generation / eval needed,
// which keeps it compatible with Hermes).

export class ProtoReader {
  pos = 0;
  readonly end: number;
  constructor(
    readonly buf: Uint8Array,
    start = 0,
    end = buf.length,
  ) {
    this.pos = start;
    this.end = end;
  }

  eof(): boolean {
    return this.pos >= this.end;
  }

  /** reads a varint as unsigned 32 bit number */
  uint32(): number {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      if (this.pos >= this.end) throw new Error('protobuf: truncated varint');
      b = this.buf[this.pos++];
      if (shift < 28) result |= (b & 0x7f) << shift;
      else if (shift < 32) result = (result | ((b & 0x7f) << shift)) >>> 0;
      shift += 7;
    } while (b & 0x80);
    return result >>> 0;
  }

  /** reads a varint as signed 64 bit number (precision is limited to 2^53) */
  int64(): number {
    let lo = 0;
    let hi = 0;
    let shift = 0;
    let b: number;
    // low 28 bits
    for (; shift < 28; shift += 7) {
      if (this.pos >= this.end) throw new Error('protobuf: truncated varint');
      b = this.buf[this.pos++];
      lo |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return lo >>> 0;
    }
    // 5th byte contributes to lo (4 bits) and hi (3 bits)
    if (this.pos >= this.end) throw new Error('protobuf: truncated varint');
    b = this.buf[this.pos++];
    lo = (lo | ((b & 0x0f) << 28)) >>> 0;
    hi = (b & 0x70) >> 4;
    if (b & 0x80) {
      for (shift = 3; shift < 32; shift += 7) {
        if (this.pos >= this.end) throw new Error('protobuf: truncated varint');
        b = this.buf[this.pos++];
        hi |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
      }
    }
    hi = hi | 0; // as signed 32 bit
    return hi * 4294967296 + lo;
  }

  int32(): number {
    return this.int64() | 0;
  }

  bool(): boolean {
    return this.int64() !== 0;
  }

  double(): number {
    if (this.pos + 8 > this.end) throw new Error('protobuf: truncated double');
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8);
    this.pos += 8;
    return view.getFloat64(0, true);
  }

  bytes(): Uint8Array {
    const len = this.uint32();
    const start = this.pos;
    this.pos += len;
    if (this.pos > this.end) throw new Error('protobuf: truncated bytes');
    return this.buf.subarray(start, start + len);
  }

  string(): string {
    return utf8Decode(this.bytes());
  }

  /** returns a reader for an embedded message */
  message(): ProtoReader {
    const len = this.uint32();
    const start = this.pos;
    this.pos += len;
    if (this.pos > this.end) throw new Error('protobuf: truncated message');
    return new ProtoReader(this.buf, start, start + len);
  }

  skip(wireType: number): void {
    switch (wireType) {
      case 0:
        this.int64();
        break;
      case 1:
        this.pos += 8;
        break;
      case 2: {
        const len = this.uint32();
        this.pos += len;
        break;
      }
      case 5:
        this.pos += 4;
        break;
      case 3: {
        // start group (deprecated) - skip until end group
        for (;;) {
          const tag = this.uint32();
          const wt = tag & 7;
          if (wt === 4) break;
          this.skip(wt);
        }
        break;
      }
      default:
        throw new Error('protobuf: invalid wire type ' + wireType);
    }
  }

  /** iterates over all fields of the message */
  forEach(handler: (field: number, wireType: number, r: ProtoReader) => boolean | void): void {
    while (this.pos < this.end) {
      const tag = this.uint32();
      const field = tag >>> 3;
      const wireType = tag & 7;
      const startPos = this.pos;
      const handled = handler(field, wireType, this);
      if (handled === false || this.pos === startPos) {
        // not consumed by handler
        if (this.pos === startPos) this.skip(wireType);
      }
    }
  }
}

let decoder: { decode(b: Uint8Array): string } | null = null;

export function utf8Decode(bytes: Uint8Array): string {
  if (decoder === null && typeof TextDecoder !== 'undefined') {
    try {
      decoder = new TextDecoder('utf-8');
    } catch {
      decoder = null;
    }
  }
  if (decoder) return decoder.decode(bytes);
  // fallback decoder
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    let cp: number;
    if (b0 < 0x80) cp = b0;
    else if (b0 < 0xe0) cp = ((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (b0 < 0xf0) cp = ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else
      cp =
        ((b0 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

export function utf8Encode(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return new Uint8Array(out);
}
