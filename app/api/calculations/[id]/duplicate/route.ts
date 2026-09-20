import crypto from "node:crypto";
import { actor, dbError, failure, ok, owned } from "../../../_route";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, db } = await actor(request);
    const c = await owned(db, "calculations", (await params).id, user.id);
    const { data, error } = await db.rpc("save_calculation", {
      p_user: user.id,
      p_id: crypto.randomUUID(),
      p_calculator: c.calculator_id,
      p_version: c.calculator_version,
      p_name: `${c.name} copy`.slice(0, 120),
      p_inputs: c.inputs,
    });
    if (error) dbError(error.message);
    return ok({ calculation: data }, 201);
  } catch (e) {
    return failure(e);
  }
}
