/**
 * Async route wrapper.
 *
 * Express 4 does not await handlers, so a rejection from an `async` handler
 * never reaches the error middleware: the request hangs until the client gives
 * up, and Node's default unhandled-rejection policy then kills the process. On
 * the identity routes that made an invalid login body — anything Zod refuses —
 * a remote, unauthenticated restart of the API.
 *
 * Every async handler goes through this, so failures land on the terminal error
 * handler in index.ts and leave as the documented JSON envelope.
 */
import type express from "express";

export function asyncRoute(
  fn: (req: express.Request, res: express.Response) => unknown,
): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };
}
