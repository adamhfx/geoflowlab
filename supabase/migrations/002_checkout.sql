begin;
create table public.checkout_requests (
 user_id uuid primary key references auth.users(id), request_key uuid not null default gen_random_uuid(),
 interval text not null check(interval in ('month','year')), url text, expires_at timestamptz,
 lease_until timestamptz, created_at timestamptz not null default now()
);
alter table public.checkout_requests enable row level security;
revoke all on public.checkout_requests from anon,authenticated;
grant all on public.checkout_requests to service_role;

create function public.begin_checkout(p_user uuid,p_interval text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r checkout_requests;
begin
 if p_interval not in ('month','year') then raise exception 'INVALID_INTERVAL';end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_user::text,0));
 select * into r from checkout_requests where user_id=p_user for update;
 if found and r.url is not null and r.expires_at>now() then return jsonb_build_object('key',r.request_key,'url',r.url,'interval',r.interval);end if;
 if found and r.lease_until>now() then return jsonb_build_object('key',r.request_key,'busy',true);end if;
 -- Failed/uncertain requests reuse the Stripe key for 23 hours; never create
 -- a second subscription because an HTTP response was lost.
 if found and r.url is null and r.created_at>now()-interval '23 hours' then
  update checkout_requests set lease_until=now()+interval '120 seconds' where user_id=p_user returning * into r;
 else
  insert into checkout_requests(user_id,interval,lease_until) values(p_user,p_interval,now()+interval '120 seconds')
  on conflict(user_id) do update set request_key=gen_random_uuid(),interval=excluded.interval,url=null,expires_at=null,lease_until=excluded.lease_until,created_at=now() returning * into r;
 end if;
 return jsonb_build_object('key',r.request_key,'interval',r.interval);
end;$$;
create function public.finish_checkout(p_user uuid,p_key uuid,p_url text,p_expires timestamptz) returns void language plpgsql security definer set search_path=public as $$
begin
 update checkout_requests set url=p_url,expires_at=p_expires,lease_until=null where user_id=p_user and request_key=p_key;
 if not found then raise exception 'CHECKOUT_LEASE_LOST';end if;
end;$$;
revoke execute on function public.begin_checkout(uuid,text),public.finish_checkout(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.begin_checkout(uuid,text),public.finish_checkout(uuid,uuid,text,timestamptz) to service_role;
commit;
