import { NextResponse } from "next/server";
import {
  actor,
  failure,
  dbError,
  body,
  ApiError,
  manifestFor,
} from "@/lib/server";
import { validateInputs } from "@/lib/validation";
export { actor, failure, dbError, body, ApiError, manifestFor, validateInputs };
export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function owned(db: any, table: string, id: string, uid: string) {
  const { data, error } = await db
    .from(table)
    .select("*")
    .eq("id", id)
    .eq("user_id", uid)
    .single();
  if (error || !data) throw new ApiError(404, "Not found.");
  return data;
}
