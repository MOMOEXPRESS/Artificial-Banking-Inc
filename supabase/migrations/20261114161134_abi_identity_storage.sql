-- ABI's identity/file data lives in Postgres. Financial ledger authority stays
-- in the existing durable API until a separately reconciled ledger cutover.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create schema if not exists abi_private;
revoke all on schema abi_private from public, anon;
grant usage on schema abi_private to authenticated;

-- Deliberately private: authenticated callers can inspect only their own
-- server-issued session. Never authorize from editable user_metadata.
create function abi_private.has_active_session()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id::text=(auth.jwt()->>'session_id') and s.user_id=auth.uid()
      and (s.not_after is null or s.not_after>now())
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<now())
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function abi_private.has_active_session() from public, anon;
grant execute on function abi_private.has_active_session() to authenticated;

create function public.abi_session_status()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('active',abi_private.has_active_session(),
  'subject',auth.uid(),'aal',auth.jwt()->>'aal','amr',auth.jwt()->'amr'); $$;
revoke all on function public.abi_session_status() from public, anon;
grant execute on function public.abi_session_status() to authenticated;

create table public.abi_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check(length(display_name)<=80),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.abi_profiles enable row level security;
revoke all on public.abi_profiles from public, anon;
grant select,insert,update on public.abi_profiles to authenticated;
create policy abi_profiles_read on public.abi_profiles for select to authenticated
 using(id=(select auth.uid()) and (select abi_private.has_active_session()));
create policy abi_profiles_insert on public.abi_profiles for insert to authenticated
 with check(id=(select auth.uid()) and (select abi_private.has_active_session()));
create policy abi_profiles_update on public.abi_profiles for update to authenticated
 using(id=(select auth.uid()) and (select abi_private.has_active_session()))
 with check(id=(select auth.uid()) and (select abi_private.has_active_session()));

create table public.abi_files (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 bucket_id text not null default 'abi-private-files' check(bucket_id='abi-private-files'),
 object_path text not null unique check(length(object_path)<=512),
 name text not null check(length(name) between 1 and 120),
 mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp','application/pdf','text/plain','text/markdown','text/csv','application/json')),
 size_bytes integer not null check(size_bytes between 1 and 5000000),
 created_at timestamptz not null default now()
);
create index abi_files_owner_created on public.abi_files(owner_id,created_at desc);
alter table public.abi_files enable row level security;
revoke all on public.abi_files from public, anon;
grant select,insert,delete on public.abi_files to authenticated;
create policy abi_files_read on public.abi_files for select to authenticated
 using(owner_id=(select auth.uid()) and (select abi_private.has_active_session()));
create policy abi_files_insert on public.abi_files for insert to authenticated
 with check(owner_id=(select auth.uid()) and split_part(object_path,'/',1)=(select auth.uid())::text and (select abi_private.has_active_session()));
create policy abi_files_delete on public.abi_files for delete to authenticated
 using(owner_id=(select auth.uid()) and (select abi_private.has_active_session()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('abi-private-files','abi-private-files',false,5000000,array['image/png','image/jpeg','image/webp','application/pdf','text/plain','text/markdown','text/csv','application/json'])
 on conflict(id) do nothing;
create policy abi_objects_read on storage.objects for select to authenticated
 using(bucket_id='abi-private-files' and (storage.foldername(name))[1]=(select auth.uid())::text and (select abi_private.has_active_session()));
create policy abi_objects_insert on storage.objects for insert to authenticated
 with check(bucket_id='abi-private-files' and (storage.foldername(name))[1]=(select auth.uid())::text and (select abi_private.has_active_session()));
create policy abi_objects_delete on storage.objects for delete to authenticated
 using(bucket_id='abi-private-files' and (storage.foldername(name))[1]=(select auth.uid())::text and (select abi_private.has_active_session()));
-- Objects are immutable: replacements use new UUID paths, never upsert.

alter publication supabase_realtime add table public.abi_files;
