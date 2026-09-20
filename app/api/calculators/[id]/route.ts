import { actor, failure, manifestFor, ok } from "../../_route";
import { publicManifest } from "@/lib/server";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await actor(request);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const result = await manifestFor(
      id,
      searchParams.get("version") ?? undefined,
    );
    return ok({
      manifest: publicManifest(result.manifest),
      approved: result.approved,
    });
  } catch (e) {
    return failure(e);
  }
}
