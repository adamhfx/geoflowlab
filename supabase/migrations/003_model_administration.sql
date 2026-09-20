begin;
create table public.app_administrators (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.model_uploads (
  id uuid primary key default gen_random_uuid(),
  calculator_id text not null references public.calculators(id),
  version text not null,
  base_version text not null,
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  file_name text not null,
  notes text not null default '' check (length(notes) <= 1000),
  status text not null default 'review_required' check (status in ('review_required','approved','rejected')),
  validation jsonb not null,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(calculator_id,version),
  unique(calculator_id,sha256,base_version),
  foreign key(calculator_id,base_version) references public.calculator_versions(calculator_id,version)
);
alter table public.app_administrators enable row level security;
alter table public.model_uploads enable row level security;
revoke all on public.app_administrators,public.model_uploads from public,anon,authenticated;
grant all on public.app_administrators,public.model_uploads to service_role;
comment on table public.app_administrators is 'Managed server-side roles. Never derived from client-editable profile metadata.';
comment on table public.model_uploads is 'Private source submissions; uploading does not approve or activate a calculation model.';
commit;
