import { actor, failure, ok } from "../_route";
import { DISPLAY_PRICES, billingEnabled } from "@/lib/billing";
import { paidAccess } from "@/lib/validation";
export async function GET(request: Request) {
  try {
    const { user, db } = await actor(request);
    const [{ data: sub }, { data: calculators }, { data: calculations }] =
      await Promise.all([
        db
          .from("subscriptions")
          .select("status,paid_until,interval,cancel_at_period_end")
          .eq("user_id", user.id)
          .maybeSingle(),
        db
          .from("calculators")
          .select("id,name,description,current_version")
          .order("name"),
        db
          .from("calculations")
          .select("*")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false }),
      ]);
    const subscription = sub ?? null;
    return ok({
      user: { id: user.id, email: user.email },
      subscription,
      canWrite: paidAccess(subscription),
      calculators: calculators ?? [],
      calculations: calculations ?? [],
      billingEnabled: billingEnabled(),
      prices: DISPLAY_PRICES,
    });
  } catch (e) {
    return failure(e);
  }
}
