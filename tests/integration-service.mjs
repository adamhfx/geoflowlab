import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const base = process.env.APP_URL || "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service)
  throw new Error("Supabase environment is not configured.");
const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const created = [];
const users = [];
const origin = new URL(base).origin;

function cookieClient() {
  const jar = new Map();
  return {
    client: createServerClient(url, anon, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (values) =>
          values.forEach(({ name, value }) => jar.set(name, value)),
      },
    }),
    cookie: () => {
      if (process.env.DEBUG_AUTH_COOKIES === "true")
        console.error(
          JSON.stringify({
            authCookies: [...jar].map(([name, value]) => ({
              name,
              length: value.length,
            })),
          }),
        );
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    },
  };
}
async function newUser() {
  const email = `modeldesk-it-${crypto.randomUUID()}@example.test`,
    password = `T-${crypto.randomBytes(24).toString("base64url")}!a9`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  users.push(data.user.id);
  const auth = cookieClient();
  const signed = await auth.client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { id: data.user.id, auth };
}
async function request(path, options = {}, auth) {
  const headers = new Headers(options.headers);
  headers.set("origin", origin);
  if (auth) headers.set("cookie", auth.cookie());
  const response = await fetch(`${base}${path}`, { ...options, headers });
  let json = null;
  try {
    json = await response.json();
  } catch {}
  return { response, json };
}
async function expect(path, status, options, auth) {
  const result = await request(path, options, auth);
  assert.equal(
    result.response.status,
    status,
    `${path}: expected ${status}, got ${result.response.status}: ${JSON.stringify(result.json)}`,
  );
  return result.json;
}
const json = (value) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});

try {
  const first = await newUser();
  const second = await newUser();
  const boot = await expect("/api/bootstrap", 200, undefined, first.auth);
  const calculator = boot.calculators[0];
  assert.ok(calculator?.id);
  const { data: version, error: versionError } = await admin
    .from("calculator_versions")
    .select("version,approved")
    .eq("calculator_id", calculator.id)
    .eq("version", calculator.current_version)
    .single();
  if (versionError) throw versionError;
  assert.equal(version.approved, false);
  const until = new Date(Date.now() + 86400000).toISOString();
  const { error: subError } = await admin
    .from("subscriptions")
    .upsert(
      { user_id: first.id, status: "active", paid_until: until },
      { onConflict: "user_id" },
    );
  if (subError) throw subError;
  const calc = (
    await expect(
      "/api/calculations",
      201,
      json({
        name: "Integration draft",
        calculatorId: calculator.id,
        version: version.version,
        inputs: {},
      }),
      first.auth,
    )
  ).calculation;
  created.push(calc.id);
  const duplicate = (
    await expect(
      `/api/calculations/${calc.id}/duplicate`,
      201,
      { method: "POST" },
      first.auth,
    )
  ).calculation;
  created.push(duplicate.id);
  const publicModel = await expect(
    `/api/calculators/${calculator.id}?version=${encodeURIComponent(version.version)}`,
    200,
    undefined,
    first.auth,
  );
  const completeInputs = Object.fromEntries(
    publicModel.manifest.fields.map((f) => [f.id, f.default]),
  );
  await expect(`/api/calculations/${calc.id}`, 404, undefined, second.auth);
  await expect(
    `/api/calculations/${calc.id}`,
    404,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", inputs: {}, revision: 1 }),
    },
    second.auth,
  );
  await expect(`/api/runs/no-such/download`, 404, undefined, second.auth);
  await expect(
    `/api/calculations/${calc.id}`,
    409,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "stale", inputs: {}, revision: 0 }),
    },
    first.auth,
  );
  await expect(
    `/api/calculations/${calc.id}`,
    200,
    {
      ...json({ name: calc.name, inputs: completeInputs, revision: 1 }),
      method: "PATCH",
    },
    first.auth,
  );
  await expect(
    `/api/calculations/${calc.id}/runs`,
    409,
    {
      ...json({ revision: 2 }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
    },
    first.auth,
  );
  await expect(
    "/api/billing/checkout",
    503,
    json({ interval: "month" }),
    first.auth,
  );
  await admin
    .from("subscriptions")
    .update({
      status: "active",
      paid_until: new Date(Date.now() - 1000).toISOString(),
    })
    .eq("user_id", first.id);
  await expect(
    "/api/calculations",
    402,
    json({
      name: "Expired",
      calculatorId: calculator.id,
      version: version.version,
      inputs: {},
    }),
    first.auth,
  );
  await expect(`/api/calculations/${calc.id}`, 200, undefined, first.auth);
  await expect("/api/bootstrap", 401, undefined);
  console.log(
    JSON.stringify({
      ok: true,
      createdUsers: users.length,
      createdCalculations: created.length,
    }),
  );
} finally {
  if (created.length)
    await admin.from("runs").delete().in("calculation_id", created);
  if (created.length)
    await admin.from("calculations").delete().in("id", created);
  if (users.length)
    await admin.from("subscriptions").delete().in("user_id", users);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}
