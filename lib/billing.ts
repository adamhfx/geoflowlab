import "server-only";
import Stripe from "stripe";
import { adminClient } from "./supabase";
import {
  DISPLAY_PRICES,
  intervalForPrice,
  safeSubscriptionStatus,
  validRecurringPrice,
  billingConfigured,
  isLiveSubscriptionStatus,
  type BillingInterval,
} from "./billing-helpers";
export {
  DISPLAY_PRICES,
  intervalForPrice,
  safeSubscriptionStatus,
  validRecurringPrice,
  billingConfigured,
  isLiveSubscriptionStatus,
  type BillingInterval,
} from "./billing-helpers";

export function billingEnabled() {
  return billingConfigured();
}
export function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("SERVICE_NOT_CONFIGURED");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
export function priceId(interval: BillingInterval) {
  return interval === "month"
    ? process.env.STRIPE_MONTHLY_PRICE_ID
    : process.env.STRIPE_ANNUAL_PRICE_ID;
}

export async function validatePrice(interval: BillingInterval) {
  if (!billingEnabled()) throw new Error("BILLING_DISABLED");
  const id = priceId(interval);
  if (!id) throw new Error("BILLING_DISABLED");
  const price = await stripeClient().prices.retrieve(id, {
    expand: ["product"],
  });
  if (!validRecurringPrice(price, interval))
    throw new Error("BILLING_PRICE_INVALID");
  return price;
}

export async function applyStripeEvent(event: Stripe.Event) {
  const db = adminClient();
  const obj = event.data.object as Stripe.Subscription | Stripe.Invoice;
  if (
    !event.type.startsWith("customer.subscription.") &&
    event.type !== "invoice.paid" &&
    event.type !== "invoice.payment_failed"
  )
    return;
  let customerId: string | null = null;
  let eventSubscriptionId: string | null = null;
  if (event.type.startsWith("customer.subscription.")) {
    const s = obj as Stripe.Subscription;
    eventSubscriptionId = s.id;
    customerId =
      typeof s.customer === "string" ? s.customer : (s.customer?.id ?? null);
  } else {
    const i = obj as Stripe.Invoice;
    customerId =
      typeof i.customer === "string" ? i.customer : (i.customer?.id ?? null);
    const parent = i.parent?.subscription_details?.subscription;
    eventSubscriptionId =
      typeof parent === "string" ? parent : (parent?.id ?? null);
    if (!eventSubscriptionId) {
      const legacy = (
        i as unknown as { subscription?: string | Stripe.Subscription | null }
      ).subscription;
      eventSubscriptionId =
        typeof legacy === "string" ? legacy : (legacy?.id ?? null);
    }
  }
  if (!customerId || !eventSubscriptionId) return;
  let canonical: Stripe.Subscription;
  try {
    const subscriptions = await stripeClient().subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    const current = subscriptions.data.sort((a, b) => b.created - a.created)[0];
    if (!current || current.id !== eventSubscriptionId) return;
    canonical = await stripeClient().subscriptions.retrieve(current.id);
  } catch (error) {
    if (
      event.type === "customer.subscription.deleted" &&
      (error as { code?: string })?.code === "resource_missing"
    )
      canonical = obj as Stripe.Subscription;
    else throw error;
  }
  const subscriptionId = canonical.id;
  customerId =
    typeof canonical.customer === "string"
      ? canonical.customer
      : (canonical.customer?.id ?? customerId);
  const items = canonical.items.data;
  const item = items.length === 1 ? items[0] : undefined;
  const interval = item?.price.recurring?.interval ?? null;
  const intervalCount = item?.price.recurring?.interval_count;
  const expected =
    interval === "month"
      ? process.env.STRIPE_MONTHLY_PRICE_ID
      : interval === "year"
        ? process.env.STRIPE_ANNUAL_PRICE_ID
        : undefined;
  if (!item || intervalCount !== 1 || !expected || item.price.id !== expected)
    return;
  let paidUntil: string | null = null;
  const paidInvoices = await stripeClient().invoices.list({
    subscription: subscriptionId,
    status: "paid",
    limit: 100,
  });
  for (const invoice of paidInvoices.data.sort(
    (a, b) => b.created - a.created,
  )) {
    const line = invoice.lines.data.find(
      (l) => l.pricing?.price_details?.price === expected && !!l.period?.end,
    );
    if (!line?.period?.end) continue;
    const price = await stripeClient().prices.retrieve(expected);
    if (interval && validRecurringPrice(price, interval as BillingInterval)) {
      paidUntil = new Date(line.period.end * 1000).toISOString();
      break;
    }
  }
  const status = safeSubscriptionStatus(canonical.status);
  const cancel = !!canonical.cancel_at_period_end;
  const { data: owner } = await db
    .from("subscriptions")
    .select("user_id,stripe_customer_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!owner?.user_id || owner.stripe_customer_id !== customerId) return;
  const { error } = await db.rpc("apply_billing_event", {
    p_event: event.id,
    p_created: event.created,
    p_user: owner.user_id,
    p_customer: customerId,
    p_subscription: subscriptionId,
    p_status: status,
    p_paid_until: paidUntil,
    p_cancel: cancel,
    p_interval: interval,
  });
  if (error) throw error;
}
