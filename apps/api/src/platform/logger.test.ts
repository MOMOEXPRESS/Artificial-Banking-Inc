import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadConfig, resetConfigForTests } from "../config.js";
import { getLogger, newRequestId, resetLoggerForTests } from "./logger.js";

afterEach(() => {
  resetLoggerForTests();
  resetConfigForTests();
});

describe("logger", () => {
  it("creates request ids and a child-capable root logger", () => {
    loadConfig({ NODE_ENV: "development", ABI_LOG_LEVEL: "silent" }, { reload: true });
    resetLoggerForTests();
    const id = newRequestId();
    assert.match(id, /^req_[a-f0-9]+$/);
    const log = getLogger();
    assert.equal(typeof log.info, "function");
    assert.doesNotThrow(() => log.info({ requestId: id }, "test"));
  });
});
