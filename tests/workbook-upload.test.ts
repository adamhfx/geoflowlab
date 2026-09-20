import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import { draftVersion, validateWorkbook } from "../lib/workbook-upload";

function workbook(inputs: string, output = "<sheet name=\"Results\" sheetId=\"2\" r:id=\"rId2\"/>", rels = "<Relationship Id=\"rId1\" Target=\"worksheets/inputs.xml\"/><Relationship Id=\"rId2\" Target=\"worksheets/results.xml\"/>") {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types xmlns=\"x\"><Override PartName=\"/xl/workbook.xml\" ContentType=\"x\"/></Types>"),
    "xl/workbook.xml": strToU8(`<workbook xmlns:r="r"><sheets><sheet name="Inputs" sheetId="1" r:id="rId1"/>${output}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships>${rels}</Relationships>`),
    "xl/worksheets/inputs.xml": strToU8(`<worksheet><sheetData><row r="1">${inputs}</row></sheetData></worksheet>`),
    "xl/worksheets/results.xml": strToU8("<worksheet><sheetData/></worksheet>"),
  });
}

test("draft versions are date stamped and isolated from released versions", () => {
  assert.equal(draftVersion("00000000-0000-0000-0000-000000000000", new Date("2026-09-20T00:00:00Z")), "upload-20260920-00000000-0000-0000-0000-000000000000");
});

test("malformed uploads are rejected before persistence", () => {
  assert.throws(() => validateWorkbook(new Uint8Array([1, 2, 3])), /valid XLSX/i);
});

test("checks formulas only in mapped input cells and requires manifest output sheets", () => {
  const manifest = { outputs: ["Results"], fields: [{ cell: "A1", required: true, blankOnNew: false }] } as any;
  assert.doesNotThrow(() => validateWorkbook(workbook('<c r="A1"><v>4</v></c><c r="B1"><f>SUM(1,2)</f></c>'), manifest));
  assert.throws(() => validateWorkbook(workbook('<c r="A1"><f>SUM(1,2)</f></c>'), manifest), /mapped input cells/i);
  assert.throws(() => validateWorkbook(workbook('<c r="A1"><v>4</v></c>', '<sheet name="Other" sheetId="2" r:id="rId2"/>'), manifest), /output sheets/i);
  assert.throws(() => validateWorkbook(workbook('<c r="A1"><v>4</v></c>', undefined, '<Relationship Id="rId1" Target="https://example.test/input.xml" TargetMode="External"/>')), /external workbook/i);
  assert.throws(() => validateWorkbook(workbook('<c r="A1"><v>4</v><!--<!ENTITY x "bad">--></c>'), manifest), /XML declarations/i);
});

