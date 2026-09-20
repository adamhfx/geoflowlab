import "server-only";
import { actor, ApiError } from "./server";

type Actor = Awaited<ReturnType<typeof actor>>;
export async function isAdministrator(db: Actor["db"], user: Actor["user"]) {
  if (!user.email_confirmed_at) return false;
  const { data, error } = await db.from("app_administrators").select("user_id").eq("user_id", user.id).maybeSingle();
  if (error) throw new ApiError(503, "Administrator access could not be checked. Please try again.");
  return !!data;
}

export async function adminActor(request: Request) {
  const account = await actor(request);
  if (!(await isAdministrator(account.db, account.user))) throw new ApiError(403, "Administrator access is required.");
  return account;
}
