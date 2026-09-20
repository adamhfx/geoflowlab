import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("database enforces ownership, subscriptions, immutable history and idempotent runs", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    const sql = (
      await readFile("supabase/migrations/001_service.sql", "utf8")
    ).replace("create extension if not exists pgcrypto;", "");
    await db.exec(sql);
    await db.exec(
      await readFile("supabase/migrations/002_checkout.sql", "utf8"),
    );
    await db.exec(await readFile("supabase/migrations/003_model_administration.sql", "utf8"));
    const alice = "00000000-0000-4000-8000-000000000001",
      bob = "00000000-0000-4000-8000-000000000002";
    const calc = "00000000-0000-4000-8000-000000000003",
      calc2 = "00000000-0000-4000-8000-000000000004";
    const key = "00000000-0000-4000-8000-000000000005";
    await db.query("insert into auth.users values($1),($2)", [alice, bob]);
    await db.query("insert into app_administrators(user_id) values($1)", [alice]);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from app_administrators"), /permission denied/);
    await assert.rejects(db.query("select * from model_uploads"), /permission denied/);
    await assert.rejects(db.query("insert into app_administrators(user_id) values($1)", [bob]), /permission denied/);
    await db.exec("reset role");
    await db.exec(`insert into calculators(id,name,description,current_version) values('test','Test','Test','v1');
 insert into calculator_versions values('test','v1','{}','private/test.xlsx','hash',false,null,now());`);
    await assert.rejects(
      db.query(
        `select save_calculation($1,$2,'test','v1','One','{"A":1}',null)`,
        [alice, calc],
      ),
      /SUBSCRIPTION_REQUIRED/,
    );
    await db.query(
      `insert into subscriptions(user_id,status,paid_until,stripe_customer_id) values($1,'active',now()+interval '1 day','cus_a'),($2,'active',now()+interval '1 day','cus_b')`,
      [alice, bob],
    );
    await db.query(
      `select save_calculation($1,$2,'test','v1','One','{"A":1}',null)`,
      [alice, calc],
    );
    await db.query(
      `select save_calculation($1,$2,'test','v1','Two','{"A":2}',null)`,
      [bob, calc2],
    );
    await assert.rejects(
      db.query("select submit_run($1,$2,1,$3)", [alice, calc, key]),
      /MODEL_REVIEW_REQUIRED/,
    );
    await db.exec(
      `update calculator_versions set approved=true,approved_at=now();`,
    );
    await assert.rejects(
      db.query("select submit_run($1,$2,1,$3)", [bob, calc, key]),
      /NOT_FOUND/,
    );
    const run = await db.query<{ id: string }>(
      `select (submit_run($1,$2,1,$3)).id`,
      [alice, calc, key],
    );
    const again = await db.query<{ id: string }>(
      `select (submit_run($1,$2,1,$3)).id`,
      [alice, calc, key],
    );
    assert.equal(run.rows[0].id, again.rows[0].id);
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from jobs"))
        .rows[0].n,
      1,
    );
    await db.query(
      `select save_calculation($1,$2,'test','v1','One revised','{"A":9}',1)`,
      [alice, calc],
    );
    assert.deepEqual(
      (
        await db.query<{ inputs: unknown }>(
          "select inputs from runs where id=$1",
          [run.rows[0].id],
        )
      ).rows[0].inputs,
      { A: 1 },
    );
    await assert.rejects(
      db.query("select submit_run($1,$2,2,$3)", [alice, calc, key]),
      /IDEMPOTENCY_CONFLICT/,
    );
    await assert.rejects(
      db.query(`select save_calculation($1,$2,'test','v1','Stale','{}',1)`, [
        alice,
        calc,
      ]),
      /REVISION_CONFLICT/,
    );
    await assert.rejects(
      db.exec(`update calculator_versions set manifest='{"changed":true}'`),
      /IMMUTABLE_MODEL_VERSION/,
    );
    await db.query(
      `update runs set status='succeeded',result='{"value":42}' where id=$1`,
      [run.rows[0].id],
    );
    await assert.rejects(
      db.query(`update runs set result='{}' where id=$1`, [run.rows[0].id]),
      /IMMUTABLE_COMPLETED_RUN/,
    );
    await db.query(
      `update subscriptions set paid_until=now()-interval '1 day' where user_id=$1`,
      [alice],
    );
    await assert.rejects(
      db.query(`select save_calculation($1,$2,'test','v1','Expired','{}',2)`, [
        alice,
        calc,
      ]),
      /SUBSCRIPTION_REQUIRED/,
    );
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
      alice,
    ]);
    await db.exec("set role authenticated");
    assert.deepEqual(
      (await db.query<{ id: string }>("select id from calculations")).rows.map(
        (r) => r.id,
      ),
      [calc],
    );
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from runs"))
        .rows[0].n,
      1,
    );
    await assert.rejects(
      db.exec(`update calculations set inputs='{}'`),
      /permission denied/,
    );
    await assert.rejects(
      db.exec(`select manifest from calculator_versions`),
      /permission denied/,
    );
    await assert.rejects(db.exec("select * from jobs"), /permission denied/);
    await assert.rejects(
      db.query(`select save_calculation($1,$2,'test','v1','Direct','{}',2)`, [
        alice,
        calc,
      ]),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
      bob,
    ]);
    await db.exec("set role authenticated");
    assert.deepEqual(
      (await db.query<{ id: string }>("select id from calculations")).rows.map(
        (r) => r.id,
      ),
      [calc2],
    );
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from runs"))
        .rows[0].n,
      0,
    );
    await db.exec("reset role");
    // Publishing a new calculator version cannot move existing calculations.
    await db.exec(
      `insert into calculator_versions values('test','v2','{}','private/test-v2.xlsx','hash-v2',true,now(),now());update calculators set current_version='v2';`,
    );
    assert.equal(
      (
        await db.query<{ calculator_version: string }>(
          "select calculator_version from calculations where id=$1",
          [calc],
        )
      ).rows[0].calculator_version,
      "v1",
    );
    // Checkout reserves one stable key; concurrent requests see a busy lease.
    const reserve = await db.query<{
      r: { key: string; busy?: boolean; url?: string };
    }>(`select begin_checkout($1,'month') r`, [alice]);
    const waiting = await db.query<{ r: { key: string; busy?: boolean } }>(
      `select begin_checkout($1,'year') r`,
      [alice],
    );
    assert.equal(reserve.rows[0].r.key, waiting.rows[0].r.key);
    assert.equal(waiting.rows[0].r.busy, true);
    await db.query(
      `select finish_checkout($1,$2,'https://checkout.stripe.com/test',now()+interval '1 hour')`,
      [alice, reserve.rows[0].r.key],
    );
    assert.equal(
      (
        await db.query<{ r: { url: string } }>(
          `select begin_checkout($1,'month') r`,
          [alice],
        )
      ).rows[0].r.url,
      "https://checkout.stripe.com/test",
    );
    // Out-of-order paid events retain verified paid periods without resurrecting cancellation.
    await db.query(
      `select apply_billing_event('evt_new',200,$1,'cus_a','sub_a','active',null,false,'month')`,
      [alice],
    );
    await db.query(
      `select apply_billing_event('evt_paid',100,$1,'cus_a','sub_a','active',now()+interval '1 day',false,'month')`,
      [alice],
    );
    assert.equal(
      (
        await db.query<{ ok: boolean }>("select has_paid_access($1) ok", [
          alice,
        ])
      ).rows[0].ok,
      true,
    );
    await db.query(
      `select apply_billing_event('evt_cancel',300,$1,'cus_a','sub_a','canceled',null,false,'month')`,
      [alice],
    );
    await db.query(
      `select apply_billing_event('evt_late',150,$1,'cus_a','sub_a','active',now()+interval '2 days',false,'month')`,
      [alice],
    );
    assert.equal(
      (
        await db.query<{ ok: boolean }>("select has_paid_access($1) ok", [
          alice,
        ])
      ).rows[0].ok,
      false,
    );
    await db.query(
      `select apply_billing_event('evt_cancel',999,$1,'cus_a','sub_a','active',now()+interval '3 days',false,'month')`,
      [alice],
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          `select count(*)::int n from billing_events where id='evt_cancel'`,
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query<{ ok: boolean }>("select has_paid_access($1) ok", [
          alice,
        ])
      ).rows[0].ok,
      false,
    );
  } finally {
    await db.close();
  }
});
