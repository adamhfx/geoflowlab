import { actor, ApiError, failure, ok, owned } from "../../../_route";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, db } = await actor(request);
    const run = await owned(db, "runs", (await params).id, user.id);
    if (run.status !== "succeeded" || !run.export_path)
      throw new ApiError(404, "Export not available.");
    const { data, error } = await db.storage
      .from("calculation-exports")
      .createSignedUrl(run.export_path, 60);
    if (error || !data?.signedUrl)
      throw new ApiError(404, "Export not available.");
    return ok({ url: data.signedUrl });
  } catch (e) {
    return failure(e);
  }
}
