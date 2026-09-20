import assert from "node:assert/strict";
import test from "node:test";
import { parseAppRoute, parsePageRoute, routeHref, type AppRoute } from "../lib/routes";

const calc = "11111111-1111-4111-8111-111111111111";
const run = "22222222-2222-4222-8222-222222222222";

test("canonical routes round trip", () => {
  const routes: AppRoute[] = [
    { view: "sales", preview: false },
    { view: "overview", preview: false },
    { view: "saved", preview: false },
    { view: "saved", preview: true },
    { view: "catalog", preview: true },
    { view: "billing", preview: false },
    { view: "models", preview: false },
    { view: "settings", preview: true },
    { view: "signin", preview: false },
    { view: "editor", preview: true, calculatorId: "state-rent", mode: "example", section: "reservoir" },
    { view: "editor", preview: false, calculationId: calc, section: "results" },
    { view: "results", preview: false, calculationId: calc, runId: run, section: "cash-flow" },
  ];
  for (const route of routes) {
    const href = routeHref(route);
    const url = new URL(href, "https://example.test");
    assert.deepEqual(parseAppRoute(url.pathname, url.search), route);
  }
});

test("rejects unsafe, ambiguous, and non-canonical URLs", () => {
  assert.equal(parsePageRoute("/workspace", "unexpected=x"), null);
  assert.equal(parsePageRoute("/workspace", "next=https://evil.test"), null);
  assert.equal(parsePageRoute("/signin", "plan=year&plan=month"), null);
  assert.equal(parsePageRoute("/signin", "next=%2Fsettings&plan=year")?.view, "signin");
  assert.equal(parsePageRoute("/subscription", "billing=success")?.view, "billing");
  assert.deepEqual(parseAppRoute("/"), { view: "sales", preview: false });
  assert.equal(parseAppRoute("/calculations/not-a-uuid"), null);
  assert.equal(parseAppRoute(`/calculations/${calc}/runs/not-a-uuid`), null);
  assert.equal(parseAppRoute("/calculations/new?calculator=https%3A%2F%2Fevil.test"), null);
  assert.equal(parseAppRoute("/calculations/new?calculator=state-rent&section=../billing"), null);
  assert.equal(parseAppRoute("/workspace?next=https%3A%2F%2Fevil.test"), null);
  assert.equal(parseAppRoute("/workspace?section=one&section=two"), null);
  assert.equal(parseAppRoute("/preview/"), null);
  assert.equal(parseAppRoute("/preview/workspace"), null);
  assert.throws(() => routeHref({ view: "results", preview: false, calculationId: "bad", runId: run }), /UUID/);
  assert.throws(() => routeHref({ view: "editor", preview: false, calculatorId: "state/rent" }), /calculator/i);
  assert.throws(() => routeHref({ view: "sales", preview: true }), /preview/i);
});
