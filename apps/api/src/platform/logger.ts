/**
 * Structured logging (pino) — free OSS, stdout JSON.
 *
 * Request IDs are attached by middleware; never log secrets or raw vault keys.
 */
import { randomBytes } from "node:crypto";
import pino from "pino";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getConfig } from "../config.js";

export type Logger = pino.Logger;

let root: Logger | undefined;

export function getLogger(): Logger {
  if (root) return root;
  const cfg = getConfig();
  root = pino({
    level: cfg.ABI_LOG_LEVEL,
    base: { service: "abi-api" },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-abi-signup-token']",
        "password",
        "guardianKey",
        "agentApiKey",
        "privateKey",
        "ABI_KEK",
        "ABI_KEY_PEPPER",
        "ABI_SIGNUP_TOKEN",
      ],
      remove: true,
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
  return root;
}

/** Reset logger between tests after config changes. */
export function resetLoggerForTests(): void {
  root = undefined;
}

export function newRequestId(): string {
  return `req_${randomBytes(8).toString("hex")}`;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
      log?: Logger;
    }
  }
}

export function requestLogMiddleware(
  req: IncomingMessage & { requestId?: string; log?: Logger; method?: string; url?: string },
  res: ServerResponse,
  next: (err?: unknown) => void,
): void {
  const headerId =
    typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : "";
  const requestId = headerId.trim() || newRequestId();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  const log = getLogger().child({ requestId });
  req.log = log;
  const start = Date.now();
  res.on("finish", () => {
    log.info(
      {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      },
      "request",
    );
  });
  next();
}
