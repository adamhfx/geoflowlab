import { test } from "node:test";
import assert from "node:assert/strict";
import { safeReturnPath } from "../lib/auth-helpers";
test("auth callbacks cannot redirect sessions to another origin", () => {
  for (const value of [
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "/\nevil.example",
    null,
  ])
    assert.equal(safeReturnPath(value), "/");
  assert.equal(safeReturnPath("/?billing=success"), "/?billing=success");
  assert.equal(safeReturnPath("/preview"), "/preview");
});
