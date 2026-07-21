import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { Socket } from "node:net";

type ExpressLike = {
  handle: (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => void;
};

/**
 * Run an Express app against a Fetch API Request and return a Fetch Response.
 * Used to embed @policyvault/api inside the Next.js /abi-api route on Vercel.
 */
export async function dispatchExpress(
  app: ExpressLike,
  req: Request,
  pathAndQuery: string,
): Promise<Response> {
  const bodyBuf = Buffer.from(await req.arrayBuffer());

  return new Promise<Response>((resolve, reject) => {
    const incoming = Readable.from(bodyBuf) as IncomingMessage;
    Object.assign(incoming, {
      method: req.method,
      url: pathAndQuery,
      headers: Object.fromEntries(req.headers.entries()),
      httpVersion: "1.1",
      httpVersionMajor: 1,
      httpVersionMinor: 1,
      socket: new Socket(),
    });

    const headerMap = new Map<string, number | string | string[]>();
    let statusCode = 200;
    const chunks: Buffer[] = [];
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      const headers = new Headers();
      for (const [k, v] of headerMap) {
        if (v === undefined) continue;
        if (Array.isArray(v)) for (const item of v) headers.append(k, item);
        else headers.set(k, String(v));
      }
      headers.delete("transfer-encoding");
      headers.set("cache-control", "no-store");
      resolve(new Response(Buffer.concat(chunks), { status: statusCode, headers }));
    };

    const outgoing: {
      statusCode: number;
      headersSent: boolean;
      setHeader: (name: string, value: number | string | readonly string[]) => void;
      getHeader: (name: string) => number | string | string[] | undefined;
      getHeaders: () => Record<string, number | string | string[]>;
      removeHeader: (name: string) => void;
      writeHead: (code: number, arg2?: unknown, arg3?: unknown) => unknown;
      write: (chunk: unknown, encoding?: unknown, cb?: unknown) => boolean;
      end: (chunk?: unknown, encoding?: unknown, cb?: unknown) => unknown;
      on: () => unknown;
      once: () => unknown;
      emit: () => boolean;
      removeListener: () => unknown;
      cork: () => void;
      uncork: () => void;
    } = {
      statusCode: 200,
      headersSent: false,
      setHeader(name, value) {
        headerMap.set(name.toLowerCase(), value as number | string | string[]);
      },
      getHeader(name) {
        return headerMap.get(name.toLowerCase());
      },
      getHeaders() {
        return Object.fromEntries(headerMap);
      },
      removeHeader(name) {
        headerMap.delete(name.toLowerCase());
      },
      writeHead(code, arg2, arg3) {
        statusCode = code;
        outgoing.statusCode = code;
        const headers =
          typeof arg2 === "object" && arg2 !== null
            ? (arg2 as Record<string, string | string[]>)
            : typeof arg3 === "object" && arg3 !== null
              ? (arg3 as Record<string, string | string[]>)
              : undefined;
        if (headers) {
          for (const [k, v] of Object.entries(headers)) outgoing.setHeader(k, v);
        }
        outgoing.headersSent = true;
        return outgoing;
      },
      write(chunk, encoding, cb) {
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(
              String(chunk),
              typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8",
            );
        chunks.push(buf);
        const done = typeof encoding === "function" ? encoding : typeof cb === "function" ? cb : null;
        if (done) (done as () => void)();
        return true;
      },
      end(chunk, encoding, cb) {
        if (chunk && typeof chunk !== "function") {
          outgoing.write(chunk, encoding);
        }
        const done =
          typeof chunk === "function"
            ? chunk
            : typeof encoding === "function"
              ? encoding
              : typeof cb === "function"
                ? cb
                : null;
        statusCode = outgoing.statusCode;
        finish();
        if (done) (done as () => void)();
        return outgoing;
      },
      on() {
        return outgoing;
      },
      once() {
        return outgoing;
      },
      emit() {
        return false;
      },
      removeListener() {
        return outgoing;
      },
      cork() {},
      uncork() {},
    };

    try {
      app.handle(incoming, outgoing as unknown as ServerResponse, (err?: unknown) => {
        if (err) {
          if (!settled) {
            settled = true;
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        } else if (!settled) {
          statusCode = outgoing.statusCode;
          finish();
        }
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
