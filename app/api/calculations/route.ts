import crypto from "node:crypto";
import {
  actor,
  body,
  dbError,
  failure,
  manifestFor,
  ok,
  validateInputs,
} from "../_route";
export async function POST(request: Request) {
  try {
    const { user, db } = await actor(request);
    const b = await body(request);
    if (
      typeof b?.name !== "string" ||
      b.name.length < 1 ||
      b.name.length > 120 ||
      typeof b?.calculatorId !== "string" ||
      !b?.inputs ||
      typeof b.inputs !== "object"
    )
      throw new Error("bad");
    const version = typeof b.version === "string" ? b.version : undefined;
    const { manifest } = await manifestFor(b.calculatorId, version);
    const v = validateInputs(b.inputs, manifest, false);
    if (v.length) throw new Error("bad");
    const { data, error } = await db.rpc("save_calculation", {
      p_user: user.id,
      p_id: crypto.randomUUID(),
      p_calculator: b.calculatorId,
      p_version: version ?? manifest.version,
      p_name: b.name,
      p_inputs: b.inputs,
    });
    if (error) dbError(error.message);
    return ok({ calculation: data }, 201);
  } catch (e) {
    return failure(e);
  }
}
