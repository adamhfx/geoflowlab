export type BillingInterval = "month" | "year";
export const DISPLAY_PRICES = {
  monthly: "CAD $49.99",
  annual: "CAD $499.99",
} as const;
export function billingConfigured(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.BILLING_ENABLED === "true" &&
    !!env.STRIPE_SECRET_KEY &&
    !!env.STRIPE_WEBHOOK_SECRET &&
    !!env.STRIPE_MONTHLY_PRICE_ID &&
    !!env.STRIPE_ANNUAL_PRICE_ID
  );
}
export function safeSubscriptionStatus(status: string) {
  return [
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "trialing",
    "paused",
  ].includes(status)
    ? status
    : "none";
}
export function isLiveSubscriptionStatus(status: string) {
  return [
    "active",
    "trialing",
    "past_due",
    "incomplete",
    "unpaid",
    "paused",
  ].includes(status);
}
export function intervalForPrice(
  id: string | null | undefined,
  month = process.env.STRIPE_MONTHLY_PRICE_ID,
  year = process.env.STRIPE_ANNUAL_PRICE_ID,
) {
  return id && id === month ? "month" : id && id === year ? "year" : null;
}
export function validRecurringPrice(
  price: {
    active: boolean;
    currency: string;
    type: string;
    unit_amount: number | null;
    recurring?: { interval: string; interval_count?: number | null } | null;
  },
  interval: BillingInterval,
) {
  return (
    price.active &&
    price.currency === "cad" &&
    price.type === "recurring" &&
    price.unit_amount === (interval === "month" ? 4999 : 49999) &&
    price.recurring?.interval === interval &&
    price.recurring.interval_count === 1
  );
}
