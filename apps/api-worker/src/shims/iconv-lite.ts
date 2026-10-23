/**
 * Minimal iconv-lite shim for Workers bundling.
 *
 * Express body-parser → raw-body calls `iconv.getDecoder`. The real package's
 * CJS `./streams` helper breaks under esbuild→workerd; ABI only needs UTF-8 JSON.
 */

type Buf = Buffer | Uint8Array | string;

function toBuffer(input: Buf): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === "string") return Buffer.from(input);
  return Buffer.from(input);
}

export function decode(buffer: Buf, encoding?: string): string {
  return toBuffer(buffer).toString((encoding as BufferEncoding | undefined) || "utf8");
}

export function encode(content: string, encoding?: string): Buffer {
  return Buffer.from(content, (encoding as BufferEncoding | undefined) || "utf8");
}

export function encodingExists(_encoding: string): boolean {
  return true;
}

export function getDecoder(_encoding?: string) {
  return {
    write(buf: Buf) {
      return decode(buf);
    },
    end() {
      return "";
    },
  };
}

export function getEncoder(_encoding?: string) {
  return {
    write(str: string) {
      return encode(str);
    },
    end() {
      return Buffer.alloc(0);
    },
  };
}

export function getCodec(_encoding: string) {
  return {
    encoder: getEncoder(),
    decoder: getDecoder(),
  };
}

const iconv = {
  decode,
  encode,
  encodingExists,
  getDecoder,
  getEncoder,
  getCodec,
  encodings: {},
};

export default iconv;
