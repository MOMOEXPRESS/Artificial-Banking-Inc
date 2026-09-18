/**
 * Express 4 does not observe the promise an `async` handler returns. A rejection
 * — including the `ZodError` that `schema.parse(req.body)` throws on a malformed
 * body — is therefore never routed to the error middleware. Node treats it as an
 * unhandled rejection and exits the process, so one badly-formed sign-in
 * request took the whole API down and every in-flight request with it.
 *
 * This forwards the rejection to `next`, where the terminal handler in
 * `index.ts` turns it into the documented JSON envelope (400 for validation,
 * 500 otherwise). Handlers that never `await` do not need it: Express catches
 * synchronous throws itself.
 */
import type express from "express";

export function asyncHandler(
  fn: (req: express.Request, res: express.Response) => Promise<unknown>,
): express.RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
