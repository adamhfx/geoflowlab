import {
  actor,
  body,
  dbError,
  failure,
  manifestFor,
  ok,
  owned,
  validateInputs,
} from "../../_route";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, db } = await actor(request);
    const c = await owned(db, "calculations", (await params).id, user.id);
    const { data: runs } = await db
      .from("runs")
      .select(
        "id,calculation_id,calculator_version,calculation_revision,status,result,created_at,finished_at,error_code",
      )
      .eq("calculation_id", c.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    return ok({ calculation: c, runs: runs ?? [] });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, db } = await actor(request);
    const b = await body(request);
    const c = await owned(db, "calculations", (await params).id, user.id);
    if (
      typeof b?.name !== "string" ||
      b.name.length < 1 ||
      b.name.length > 120 ||
      !b.inputs ||
      typeof b.revision !== "number"
    )
      throw new Error("bad");
    const { manifest } = await manifestFor(
      c.calculator_id,
      c.calculator_version,
    );
    if (validateInputs(b.inputs, manifest, false).length)
      throw new Error("bad");
    const { data, error } = await db.rpc("save_calculation", {
      p_user: user.id,
      p_id: c.id,
      p_calculator: c.calculator_id,
      p_version: c.calculator_version,
      p_name: b.name,
      p_inputs: b.inputs,
      p_revision: b.revision,
    });
    if (error) dbError(error.message);
    return ok({ calculation: data });
  } catch (e) {
    return failure(e);
  }
}
