import { actor, ApiError, failure, ok } from "../../_route";
import { billingEnabled, stripeClient } from "@/lib/billing";
export async function POST(request: Request) {
  try {
    const { user, db } = await actor(request);
    if (!billingEnabled()) throw new ApiError(503, "Billing is not available.");
    const { data: sub } = await db
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!sub?.stripe_customer_id)
      throw new ApiError(404, "Billing account not found.");
    const c = await stripeClient().customers.retrieve(sub.stripe_customer_id);
    if (c.deleted) throw new ApiError(404, "Billing account not found.");
    const s = await stripeClient().billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${process.env.APP_URL}/subscription`,
    });
    return ok({ url: s.url });
  } catch (e) {
    return failure(e);
  }
}
