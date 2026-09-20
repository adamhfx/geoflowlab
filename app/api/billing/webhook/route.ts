import { NextResponse } from "next/server";
import { stripeClient, applyStripeEvent } from "@/lib/billing";
export async function POST(request: Request) {
  const sig = request.headers.get("stripe-signature");
  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET)
    return NextResponse.json({ error: "Invalid webhook." }, { status: 400 });
  let event;
  try {
    event = stripeClient().webhooks.constructEvent(
      await request.text(),
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 400 },
    );
  }
  try {
    await applyStripeEvent(event);
    return NextResponse.json({ received: true });
  } catch {
    console.error(
      JSON.stringify({
        event: "billing_sync_failed",
        event_id: event.id,
        type: event.type,
      }),
    );
    return NextResponse.json(
      { error: "Billing synchronization failed; retry delivery." },
      { status: 500 },
    );
  }
}
