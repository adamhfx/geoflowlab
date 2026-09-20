import { actor, body, ApiError, failure, ok } from "../../_route";
import {
  billingEnabled,
  priceId,
  stripeClient,
  validatePrice,
  type BillingInterval,
} from "@/lib/billing";
export async function POST(request: Request) {
  try {
    const { user, db } = await actor(request);
    if (!billingEnabled()) throw new ApiError(503, "Billing is not available.");
    const input = await body(request);
    if (input?.interval !== "month" && input?.interval !== "year")
      throw new ApiError(400, "Invalid billing interval.");
    const interval = input.interval as BillingInterval;
    await validatePrice(interval);
    const { data: sub } = await db
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();
    let customer = sub?.stripe_customer_id;
    if (!customer) {
      const created = await stripeClient().customers.create(
        { email: user.email ?? undefined },
        { idempotencyKey: `customer-${user.id}` },
      );
      customer = created.id;
      const { error } = await db
        .from("subscriptions")
        .insert({
          user_id: user.id,
          stripe_customer_id: customer,
          status: "none",
        });
      if (error) {
        const existing = await db
          .from("subscriptions")
          .select("stripe_customer_id")
          .eq("user_id", user.id)
          .single();
        if (existing.error || existing.data?.stripe_customer_id !== customer)
          throw error;
      }
    }
    const live = await stripeClient().subscriptions.list({
      customer,
      status: "all",
      limit: 100,
    });
    if (
      live.data.some((s) =>
        [
          "active",
          "trialing",
          "past_due",
          "incomplete",
          "unpaid",
          "paused",
        ].includes(s.status),
      )
    )
      throw new ApiError(409, "You already have an active subscription.");
    const { data: lease, error: leaseError } = await db.rpc("begin_checkout", {
      p_user: user.id,
      p_interval: interval,
    });
    if (leaseError) throw leaseError;
    if (lease?.interval && lease.interval !== interval)
      throw new ApiError(
        409,
        "A checkout for the other billing interval is already open. Return to that plan to continue.",
      );
    if (lease?.url) return ok({ url: lease.url });
    if (lease?.busy)
      throw new ApiError(
        409,
        "Checkout is already being created. Try again shortly.",
      );
    if (typeof lease?.key !== "string")
      throw new ApiError(503, "Checkout is unavailable.");
    const sessionInterval =
      lease.interval === "month" || lease.interval === "year"
        ? lease.interval
        : interval;
    await validatePrice(sessionInterval);
    const session = await stripeClient().checkout.sessions.create(
      {
        mode: "subscription",
        customer,
        line_items: [{ price: priceId(sessionInterval), quantity: 1 }],
        success_url: `${process.env.APP_URL}/subscription?billing=success`,
        cancel_url: `${process.env.APP_URL}/subscription?billing=cancelled`,
        client_reference_id: user.id,
      },
      { idempotencyKey: `checkout-${user.id}-${lease.key}` },
    );
    if (!session.url) throw new ApiError(502, "Checkout is unavailable.");
    const { error: finishError } = await db.rpc("finish_checkout", {
      p_user: user.id,
      p_key: lease.key,
      p_url: session.url,
      p_expires: new Date(
        (session.expires_at ?? Math.floor(Date.now() / 1000) + 1800) * 1000,
      ).toISOString(),
    });
    if (finishError) throw finishError;
    return ok({ url: session.url });
  } catch (e) {
    return failure(e);
  }
}
