-- Per-user private broadcasts avoid the RLS limitations of table DELETE feeds.
alter publication supabase_realtime drop table public.abi_files;
create function abi_private.notify_file_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare owner uuid; file_id uuid;
begin
  if TG_OP='DELETE' then owner:=OLD.owner_id; file_id:=OLD.id;
  else owner:=NEW.owner_id; file_id:=NEW.id; end if;
  if auth.uid() is distinct from owner or not abi_private.has_active_session() then
    if TG_OP='DELETE' then return OLD; else return NEW; end if;
  end if;
  perform realtime.send(jsonb_build_object('id',file_id),TG_OP,'abi:files:'||owner::text,true);
  if TG_OP='DELETE' then return OLD; else return NEW; end if;
end;
$$;
revoke all on function abi_private.notify_file_change() from public,anon,authenticated;
create trigger abi_file_changes after insert or delete on public.abi_files
 for each row execute function abi_private.notify_file_change();
create policy abi_file_events_read on realtime.messages for select to authenticated
 using(extension='broadcast' and (select realtime.topic())='abi:files:'||(select auth.uid())::text and (select abi_private.has_active_session()));
