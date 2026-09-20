import assert from "node:assert/strict";
import test from "node:test";
import { previewManifest } from "../app/preview/manifest";
import { changeInput, inputOptions, optionLabel } from "../lib/input-options";
import { initialInputs, validateInputs } from "../lib/validation";
import type { Manifest } from "../lib/types";

test("primary fluid controls units while preserving the workbook values", () => {
  const m: Manifest = { ...JSON.parse(JSON.stringify(previewManifest)), outputs: [], multipliers: [], runtimeSha256: "" };
  const field = m.fields.find((field) => field.id === "C6")!;
  const baseline = initialInputs(m, "example");
  assert.deepEqual(inputOptions(m, field, baseline), ["scf(gas)", "m3(gas)"]);
  const oil = changeInput(m, baseline, "C5", "oil");
  assert.equal(oil.C6, null);
  assert.equal(oil.C7, null);
  assert.equal(baseline.C6, "scf(gas)");
  assert.deepEqual(inputOptions(m, field, oil), ["barrels(oil)", "tonnes(oil)"]);
  for (const [key, value] of Object.entries(baseline))
    if (!["C5", "C6", "C7"].includes(key)) assert.equal(oil[key], value);
  assert.equal(optionLabel("oil"), "Oil");
  assert.equal(optionLabel("NG"), "Natural gas");
  assert.equal(optionLabel("CTR"), "CTR");
  assert.equal(optionLabel("m3(gas)"), "m³ (Gas)");
  assert.ok(validateInputs({ ...baseline, C5: "oil" }, m, true).some((error) => error.includes("must match")));
  assert.deepEqual(inputOptions(m, field, { ...baseline, C5: null }), []);
  assert.deepEqual(inputOptions({ ...m, id: "another-calculator" }, field, oil), field.options);
});
