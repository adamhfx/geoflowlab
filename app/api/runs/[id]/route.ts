import { actor, failure, ok, owned } from "../../_route";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, db } = await actor(request);
    return ok({ run: await owned(db, "runs", (await params).id, user.id) });
  } catch (e) {
    return failure(e);
  }
}
