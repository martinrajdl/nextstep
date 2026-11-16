-- Optional hosted adapter. Apply with a migration/admin connection, never the
-- runtime role. This schema must not be added to the Supabase Data API schemas.
create schema if not exists nextstep;
revoke all on schema nextstep from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'nextstep_app') then
    create role nextstep_app login noinherit nobypassrls;
  end if;
end $$;
grant usage on schema nextstep to nextstep_app;

create table if not exists nextstep.schema_version (
  id boolean primary key default true check (id),
  version integer not null,
  applied_at timestamptz not null default now()
);
revoke all on nextstep.schema_version from public, anon, authenticated, nextstep_app;

create table if not exists nextstep.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  revision bigint not null default 1,
  ready boolean not null default true,
  import_fingerprint text,
  created_at timestamptz not null default now()
);
create table if not exists nextstep.members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references nextstep.workspaces(id),
  email text not null check (email = lower(email) and length(email) <= 254),
  user_id uuid references auth.users(id),
  role text not null check (role in ('owner','editor','viewer')),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id,email),
  unique (workspace_id,user_id)
);
create index if not exists members_user on nextstep.members(user_id, workspace_id) where disabled_at is null;
create table if not exists nextstep.entities (
  workspace_id uuid not null references nextstep.workspaces(id),
  table_name text not null check (table_name in ('crm_meta','crm_collections','crm_records','crm_views','crm_changes','crm_events','crm_flows','crm_flow_updates','crm_policy','crm_note_library','crm_note_documents','crm_note_sync')),
  row_id text not null check (length(row_id) between 1 and 120),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  primary key (workspace_id,table_name,row_id)
);
create table if not exists nextstep.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references nextstep.workspaces(id),
  user_id uuid not null references auth.users(id),
  label text not null check (length(label) between 1 and 80),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists agent_tokens_owner on nextstep.agent_tokens(workspace_id,user_id);
create table if not exists nextstep.audit (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references nextstep.workspaces(id),
  user_id uuid not null references auth.users(id),
  agent_token_id uuid references nextstep.agent_tokens(id),
  action text not null,
  change_id text,
  created_at timestamptz not null default now()
);
create index if not exists audit_workspace on nextstep.audit(workspace_id,id);

create or replace function nextstep.request_user_id() returns uuid language sql stable
  set search_path = '' as $$ select nullif(current_setting('nextstep.user_id',true),'')::uuid $$;
create or replace function nextstep.request_email() returns text language sql stable
  set search_path = '' as $$ select nullif(current_setting('nextstep.email',true),'') $$;
revoke all on function nextstep.request_user_id(),nextstep.request_email() from public;
grant execute on function nextstep.request_user_id(),nextstep.request_email() to nextstep_app;

alter table nextstep.members enable row level security;
alter table nextstep.members force row level security;
create policy member_read on nextstep.members for select to nextstep_app using
  (disabled_at is null and (user_id = (select nextstep.request_user_id()) or
    (user_id is null and email = (select nextstep.request_email()))));
create policy member_claim on nextstep.members for update to nextstep_app
  using (disabled_at is null and (user_id = (select nextstep.request_user_id()) or (user_id is null and email = (select nextstep.request_email()))))
  with check (disabled_at is null and user_id = (select nextstep.request_user_id()));
grant select on nextstep.members to nextstep_app;
grant update(user_id) on nextstep.members to nextstep_app;

alter table nextstep.workspaces enable row level security;
alter table nextstep.workspaces force row level security;
create policy workspace_read on nextstep.workspaces for select to nextstep_app using
  (ready and exists (select 1 from nextstep.members m where m.workspace_id=workspaces.id and m.user_id=(select nextstep.request_user_id()) and m.disabled_at is null));
create policy workspace_write on nextstep.workspaces for update to nextstep_app using
  (exists (select 1 from nextstep.members m where m.workspace_id=workspaces.id and m.user_id=(select nextstep.request_user_id()) and m.role in ('owner','editor') and m.disabled_at is null))
  with check (exists (select 1 from nextstep.members m where m.workspace_id=workspaces.id and m.user_id=(select nextstep.request_user_id()) and m.role in ('owner','editor') and m.disabled_at is null));
grant select on nextstep.workspaces to nextstep_app;
grant update(revision) on nextstep.workspaces to nextstep_app;

alter table nextstep.entities enable row level security;
alter table nextstep.entities force row level security;
create policy entity_read on nextstep.entities for select to nextstep_app using
  (exists (select 1 from nextstep.members m where m.workspace_id=entities.workspace_id and m.user_id=(select nextstep.request_user_id()) and m.disabled_at is null));
create policy entity_write on nextstep.entities for all to nextstep_app using
  (exists (select 1 from nextstep.members m where m.workspace_id=entities.workspace_id and m.user_id=(select nextstep.request_user_id()) and m.role in ('owner','editor') and m.disabled_at is null))
  with check (exists (select 1 from nextstep.members m where m.workspace_id=entities.workspace_id and m.user_id=(select nextstep.request_user_id()) and m.role in ('owner','editor') and m.disabled_at is null));
grant select,insert,update,delete on nextstep.entities to nextstep_app;

alter table nextstep.agent_tokens enable row level security;
alter table nextstep.agent_tokens force row level security;
create policy token_owner on nextstep.agent_tokens for all to nextstep_app using
  (user_id=(select nextstep.request_user_id()) and exists (select 1 from nextstep.members m where m.workspace_id=agent_tokens.workspace_id and m.user_id=(select nextstep.request_user_id()) and m.role in ('owner','editor') and m.disabled_at is null))
  with check (user_id=(select nextstep.request_user_id()) and exists (select 1 from nextstep.members m where m.workspace_id=agent_tokens.workspace_id and m.user_id=(select nextstep.request_user_id()) and m.role in ('owner','editor') and m.disabled_at is null));
grant select,insert on nextstep.agent_tokens to nextstep_app;
grant update(revoked_at) on nextstep.agent_tokens to nextstep_app;

alter table nextstep.audit enable row level security;
alter table nextstep.audit force row level security;
create policy audit_read on nextstep.audit for select to nextstep_app using
  (exists (select 1 from nextstep.members m where m.workspace_id=audit.workspace_id and m.user_id=(select nextstep.request_user_id()) and m.disabled_at is null));
create policy audit_insert on nextstep.audit for insert to nextstep_app with check
  (user_id=(select nextstep.request_user_id()) and exists (select 1 from nextstep.members m where m.workspace_id=audit.workspace_id and m.user_id=(select nextstep.request_user_id()) and m.role in ('owner','editor') and m.disabled_at is null));
grant select,insert on nextstep.audit to nextstep_app;
grant usage on sequence nextstep.audit_id_seq to nextstep_app;

-- A credential lookup is the sole definer function. It is private, accepts only
-- a 256-bit credential hash and returns no CRM data. Membership is checked again
-- inside each subsequent transaction. No caller can choose a user or workspace.
create or replace function nextstep.authenticate_agent(credential_hash text)
returns table(user_id uuid,workspace_id uuid,token_id uuid,label text)
language sql stable security definer set search_path = '' as $$
  select t.user_id,t.workspace_id,t.id,t.label from nextstep.agent_tokens t
  join nextstep.members m on m.workspace_id=t.workspace_id and m.user_id=t.user_id
  where credential_hash ~ '^[a-f0-9]{64}$' and t.token_hash=credential_hash
    and t.revoked_at is null and t.expires_at>now() and m.disabled_at is null
    and m.role in ('owner','editor')
$$;
revoke all on function nextstep.authenticate_agent(text) from public,anon,authenticated;
grant execute on function nextstep.authenticate_agent(text) to nextstep_app;

insert into nextstep.schema_version(id,version) values(true,1);
