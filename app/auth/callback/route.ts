import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase";
import { safeReturnPath } from "@/lib/auth-helpers";
import { cookies } from "next/headers";
export async function GET(request: Request) {
  const u = new URL(request.url),
    origin = process.env.APP_URL || u.origin;
  const failed = () => NextResponse.redirect(new URL("/?error=auth", origin));
  try {
    const supabase = await userClient(),
      code = u.searchParams.get("code");
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return failed();
    } else {
      const token = u.searchParams.get("token_hash"),
        type = u.searchParams.get("type") || "email";
      if (!token || !["email", "magiclink", "signup", "invite"].includes(type))
        return failed();
      const { error } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: type as "email" | "magiclink" | "signup" | "invite",
      });
      if (error) return failed();
    }
    const returnPath = u.searchParams.get("next") || (await cookies()).get("geoflow-return-path")?.value || null;
    let decoded = returnPath;
    try { if (!u.searchParams.has("next") && returnPath) decoded = decodeURIComponent(returnPath); } catch { decoded = null; }
    const response = NextResponse.redirect(new URL(safeReturnPath(decoded), origin));
    response.cookies.delete("geoflow-return-path");
    return response;
  } catch {
    return failed();
  }
}
