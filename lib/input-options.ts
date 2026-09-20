import type { Field, InputValues, Manifest } from "./types";

const optionLabels: Record<string, string> = {
  oil: "Oil",
  NG: "Natural gas",
  "barrels(oil)": "Barrels (Oil)",
  "tonnes(oil)": "Tonnes (Oil)",
  "scf(gas)": "scf (Gas)",
  "m3(gas)": "m³ (Gas)",
  X: "Completed",
};

// Display labels never change the workbook's stored option values.
export function optionLabel(value: string) {
  return optionLabels[value] ?? value;
}

export function isFluidUnit(manifest: Manifest, field: Field) {
  return manifest.id === "state-rent" && ["C6", "C7"].includes(field.id);
}

export function inputOptions(manifest: Manifest, field: Field, inputs: InputValues) {
  const options = field.options ?? [];
  if (!isFluidUnit(manifest, field)) return options;
  const suffix = inputs.C5 === "oil" ? "(oil)" : inputs.C5 === "NG" ? "(gas)" : null;
  return suffix ? options.filter((option) => option.endsWith(suffix)) : [];
}

export function changeInput(manifest: Manifest | null, inputs: InputValues, id: string, value: string | number | null) {
  const next = { ...inputs, [id]: value };
  if (manifest?.id === "state-rent" && id === "C5") {
    for (const field of manifest.fields.filter((field) => isFluidUnit(manifest, field))) {
      if (next[field.id] && !inputOptions(manifest, field, next).includes(String(next[field.id]))) next[field.id] = null;
    }
  }
  return next;
}
