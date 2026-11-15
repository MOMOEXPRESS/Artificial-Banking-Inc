import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePrivateFile } from "./private-file-validation";
test("private uploads check actual content and never accept active HTML/SVG or disguised binaries", () => {
  assert.equal(
    validatePrivateFile("notes.txt", new TextEncoder().encode("Private notes")).mime,
    "text/plain",
  );
  assert.equal(
    validatePrivateFile("../name.json", new TextEncoder().encode('{"ok":true}')).name,
    ".._name.json",
  );
  assert.throws(() =>
    validatePrivateFile("image.png", new TextEncoder().encode("<html>bad</html>")),
  );
  assert.throws(() => validatePrivateFile("picture.svg", new TextEncoder().encode("<svg/>")));
  assert.throws(() => validatePrivateFile("data.json", new TextEncoder().encode("{bad}")));
  assert.throws(() => validatePrivateFile("empty.txt", new Uint8Array()));
  assert.throws(() => validatePrivateFile("large.txt", new Uint8Array(3000001)));
  assert.throws(() => validatePrivateFile("binary.txt", new Uint8Array([255, 254, 0])));
  assert.equal(
    validatePrivateFile("document.pdf", new TextEncoder().encode("%PDF-1.7\n")).mime,
    "application/pdf",
  );
});
