begin;
create extension if not exists pgcrypto;
create table public.calculators (
 id text primary key, name text not null, description text not null, current_version text, created_at timestamptz not null default now()
);
create table public.calculator_versions (
 calculator_id text not null references public.calculators(id), version text not null,
 manifest jsonb not null, template_path text not null, template_sha256 text not null,
 approved boolean not null default false, approved_at timestamptz, created_at timestamptz not null default now(),
 primary key(calculator_id,version), check(not approved or approved_at is not null)
);
create table public.subscriptions (
 user_id uuid primary key references auth.users(id), stripe_customer_id text unique,
 stripe_subscription_id text unique, status text not null default 'none', paid_until timestamptz,
 cancel_at_period_end boolean not null default false, interval text, updated_at timestamptz not null default now(),
 event_created bigint not null default 0
);
create table public.calculations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 calculator_id text not null, calculator_version text not null, name text not null check(length(name) between 1 and 120),
 inputs jsonb not null, revision integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(calculator_id,calculator_version) references public.calculator_versions(calculator_id,version)
);
create table public.runs (
 id uuid primary key default gen_random_uuid(), calculation_id uuid not null references public.calculations(id), user_id uuid not null references auth.users(id),
 calculator_id text not null, calculator_version text not null, inputs jsonb not null,
 calculation_revision integer not null, idempotency_key uuid not null,
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed')),
 result jsonb, export_path text, error_code text, created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
 unique(user_id,idempotency_key), foreign key(calculator_id,calculator_version) references public.calculator_versions(calculator_id,version)
);
create table public.jobs (
 id uuid primary key default gen_random_uuid(), run_id uuid not null unique references public.runs(id),
 state text not null default 'queued' check(state in ('queued','running','done','failed')),
 attempts integer not null default 0, worker_id text, lease_token uuid, lease_until timestamptz,
 available_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.billing_events (id text primary key, event_created bigint not null, processed_at timestamptz not null default now());
create index calculations_owner on public.calculations(user_id,updated_at desc);
create index runs_owner_calculation on public.runs(user_id,calculation_id,created_at desc);
create index jobs_pending on public.jobs(state,available_at);

alter table public.calculators enable row level security;
alter table public.calculator_versions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.calculations enable row level security;
alter table public.runs enable row level security;
alter table public.jobs enable row level security;
alter table public.billing_events enable row level security;
revoke all on public.calculators,public.calculator_versions,public.subscriptions,public.calculations,public.runs,public.jobs,public.billing_events from anon,authenticated;
grant select on public.calculators,public.subscriptions,public.calculations,public.runs to authenticated;
create policy catalog_read on public.calculators for select to authenticated using (true);
create policy own_subscription on public.subscriptions for select to authenticated using(user_id=(select auth.uid()));
create policy own_calculations on public.calculations for select to authenticated using(user_id=(select auth.uid()));
create policy own_runs on public.runs for select to authenticated using(user_id=(select auth.uid()));
grant all on public.calculators,public.calculator_versions,public.subscriptions,public.calculations,public.runs,public.jobs,public.billing_events to service_role;

create function public.has_paid_access(p_user uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from subscriptions where user_id=p_user and status in ('active','past_due') and paid_until>now());
$$;
create function public.save_calculation(p_user uuid,p_id uuid,p_calculator text,p_version text,p_name text,p_inputs jsonb,p_revision integer default null)
returns public.calculations language plpgsql security definer set search_path=public as $$
declare rec calculations;
begin
 if not has_paid_access(p_user) then raise exception 'SUBSCRIPTION_REQUIRED'; end if;
 if p_revision is null then
  insert into calculations(id,user_id,calculator_id,calculator_version,name,inputs) values(p_id,p_user,p_calculator,p_version,p_name,p_inputs) returning * into rec;
 else
  update calculations set name=p_name,inputs=p_inputs,revision=revision+1,updated_at=now()
   where id=p_id and user_id=p_user and revision=p_revision and calculator_id=p_calculator and calculator_version=p_version returning * into rec;
  if not found then raise exception 'REVISION_CONFLICT';end if;
 end if;
 return rec;
end;$$;
create function public.submit_run(p_user uuid,p_calculation uuid,p_revision integer,p_key uuid)
returns public.runs language plpgsql security definer set search_path=public as $$
declare c calculations; r runs; approved_model boolean;
begin
 if not has_paid_access(p_user) then raise exception 'SUBSCRIPTION_REQUIRED';end if;
 -- Serializes same-account submission, including retries against different calculations.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into r from runs where user_id=p_user and idempotency_key=p_key;
 if found then
  if r.calculation_id<>p_calculation or r.calculation_revision<>p_revision then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return r;
 end if;
 select * into c from calculations where id=p_calculation and user_id=p_user for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if c.revision<>p_revision then raise exception 'REVISION_CONFLICT';end if;
 select approved into approved_model from calculator_versions where calculator_id=c.calculator_id and version=c.calculator_version;
 if not coalesce(approved_model,false) then raise exception 'MODEL_REVIEW_REQUIRED';end if;
 if exists(select 1 from runs where user_id=p_user and status in ('queued','running')) then raise exception 'RUN_IN_PROGRESS';end if;
 insert into runs(calculation_id,user_id,calculator_id,calculator_version,inputs,calculation_revision,idempotency_key)
 values(c.id,p_user,c.calculator_id,c.calculator_version,c.inputs,c.revision,p_key) returning * into r;
 insert into jobs(run_id) values(r.id);return r;
end;$$;

create function public.apply_billing_event(p_event text,p_created bigint,p_user uuid,p_customer text,p_subscription text,p_status text,p_paid_until timestamptz,p_cancel boolean,p_interval text)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('billing:'||p_user::text,0));
 if exists(select 1 from billing_events where id=p_event) then return;end if;
 insert into subscriptions(user_id,stripe_customer_id,stripe_subscription_id,status,paid_until,cancel_at_period_end,interval,event_created)
 values(p_user,p_customer,p_subscription,p_status,p_paid_until,p_cancel,p_interval,p_created)
 on conflict(user_id) do update set
 stripe_subscription_id=case when subscriptions.event_created<=excluded.event_created then excluded.stripe_subscription_id else subscriptions.stripe_subscription_id end,
 status=case when subscriptions.event_created<=excluded.event_created then excluded.status else subscriptions.status end,
 paid_until=case when subscriptions.stripe_subscription_id is null or subscriptions.stripe_subscription_id=excluded.stripe_subscription_id then greatest(subscriptions.paid_until,excluded.paid_until) when subscriptions.event_created<=excluded.event_created then excluded.paid_until else subscriptions.paid_until end,
 cancel_at_period_end=case when subscriptions.event_created<=excluded.event_created then excluded.cancel_at_period_end else subscriptions.cancel_at_period_end end,
 interval=case when subscriptions.event_created<=excluded.event_created then excluded.interval else subscriptions.interval end,
 event_created=greatest(subscriptions.event_created,excluded.event_created),updated_at=now()
 where subscriptions.stripe_customer_id=excluded.stripe_customer_id;
 insert into billing_events(id,event_created) values(p_event,p_created) on conflict do nothing;
end;$$;

-- Version payloads are immutable; only approval metadata may change.
create function public.guard_version() returns trigger language plpgsql as $$
begin
 if new.manifest is distinct from old.manifest or new.template_path<>old.template_path or new.template_sha256<>old.template_sha256 or new.version<>old.version or new.calculator_id<>old.calculator_id then raise exception 'IMMUTABLE_MODEL_VERSION';end if;return new;
end;$$;
create trigger immutable_model before update on public.calculator_versions for each row execute function public.guard_version();
create function public.guard_run() returns trigger language plpgsql as $$
begin
 if new.inputs is distinct from old.inputs or new.user_id<>old.user_id or new.calculator_id<>old.calculator_id or new.calculator_version<>old.calculator_version or new.calculation_id<>old.calculation_id or new.calculation_revision<>old.calculation_revision then raise exception 'IMMUTABLE_RUN_INPUTS';end if;
 if old.status='succeeded' then raise exception 'IMMUTABLE_COMPLETED_RUN';end if;return new;
end;$$;
create trigger immutable_run before update on public.runs for each row execute function public.guard_run();
revoke execute on function public.has_paid_access(uuid),public.save_calculation(uuid,uuid,text,text,text,jsonb,integer),public.submit_run(uuid,uuid,integer,uuid),public.apply_billing_event(text,bigint,uuid,text,text,text,timestamptz,boolean,text) from public,anon,authenticated;
grant execute on function public.has_paid_access(uuid),public.save_calculation(uuid,uuid,text,text,text,jsonb,integer),public.submit_run(uuid,uuid,integer,uuid),public.apply_billing_event(text,bigint,uuid,text,text,text,timestamptz,boolean,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('model-templates','model-templates',false,20971520,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
 ('calculation-exports','calculation-exports',false,20971520,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) on conflict(id) do nothing;
-- No client storage policies: source templates are server-only, exports use checked signed URLs.
commit;
