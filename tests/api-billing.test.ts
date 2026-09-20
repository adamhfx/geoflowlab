import test from "node:test";
import assert from "node:assert/strict";
import {
  billingConfigured,
  intervalForPrice,
  safeSubscriptionStatus,
  validRecurringPrice,
} from "../lib/billing-helpers";

test("billing remains disabled unless all server credentials and both price ids exist", () => {
  const old = {
    enabled: process.env.BILLING_ENABLED,
    secret: process.env.STRIPE_SECRET_KEY,
    webhook: process.env.STRIPE_WEBHOOK_SECRET,
    month: process.env.STRIPE_MONTHLY_PRICE_ID,
    year: process.env.STRIPE_ANNUAL_PRICE_ID,
  };
  process.env.BILLING_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY = "sk_test";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_MONTHLY_PRICE_ID = "price_month";
  process.env.STRIPE_ANNUAL_PRICE_ID = "price_year";
  assert.equal(billingConfigured(), true);
  delete process.env.STRIPE_WEBHOOK_SECRET;
  assert.equal(billingConfigured(), false);
  Object.assign(process.env, {
    BILLING_ENABLED: old.enabled ?? "",
    STRIPE_SECRET_KEY: old.secret ?? "",
    STRIPE_WEBHOOK_SECRET: old.webhook ?? "",
    STRIPE_MONTHLY_PRICE_ID: old.month ?? "",
    STRIPE_ANNUAL_PRICE_ID: old.year ?? "",
  });
});

test("price mapping and status allowlist reject untrusted values", () => {
  const oldMonth = process.env.STRIPE_MONTHLY_PRICE_ID;
  const oldYear = process.env.STRIPE_ANNUAL_PRICE_ID;
  process.env.STRIPE_MONTHLY_PRICE_ID = "m";
  process.env.STRIPE_ANNUAL_PRICE_ID = "y";
  assert.equal(intervalForPrice("m"), "month");
  assert.equal(intervalForPrice("y"), "year");
  assert.equal(intervalForPrice("other"), null);
  assert.equal(safeSubscriptionStatus("active"), "active");
  assert.equal(safeSubscriptionStatus("forged"), "none");
  if (oldMonth === undefined) delete process.env.STRIPE_MONTHLY_PRICE_ID;
  else process.env.STRIPE_MONTHLY_PRICE_ID = oldMonth;
  if (oldYear === undefined) delete process.env.STRIPE_ANNUAL_PRICE_ID;
  else process.env.STRIPE_ANNUAL_PRICE_ID = oldYear;
});

test("entitlement price validation requires active CAD recurring prices with one interval", () => {
  const price = {
    active: true,
    currency: "cad",
    type: "recurring",
    unit_amount: 4999,
    recurring: { interval: "month", interval_count: 1 },
  };
  assert.equal(validRecurringPrice(price, "month"), true);
  assert.equal(
    validRecurringPrice({ ...price, currency: "usd" }, "month"),
    false,
  );
  assert.equal(
    validRecurringPrice(
      { ...price, recurring: { interval: "month", interval_count: 2 } },
      "month",
    ),
    false,
  );
});
