-- =====================================================================
-- ChatSphere - Supabase schema (v2)
-- Run in: Supabase Dashboard > SQL Editor > New query > Run
-- Works on a fresh project AND on a project that already ran v1.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. BASE TABLES (same as v1, safe to re-run)
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  bio           text not null default '' check (char_length(bio) <= 300),
  profile_image text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  is_group        boolean not null default false,
  title           text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);


-- ---------------------------------------------------------------------
-- 2. V2 COLUMNS AND NEW TABLES
-- ---------------------------------------------------------------------

-- Profiles: public encryption key (JWK) and last seen time
alter table public.profiles add column if not exists public_key jsonb;
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- Group membership: admin or member
alter table public.conversation_members
  add column if not exists role text not null default 'member'
  check (role in ('admin', 'member'));

-- Messages: encryption, files, unsend
alter table public.messages alter column body drop not null;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check
  check (body is null or char_length(body) <= 16000);

alter table public.messages add column if not exists is_encrypted boolean not null default false;
alter table public.messages add column if not exists key_version int not null default 0;
alter table public.messages add column if not exists kind text not null default 'text'
  check (kind in ('text', 'file'));
alter table public.messages add column if not exists attachment_path text;
alter table public.messages add column if not exists deleted_at timestamptz;

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check
  check (deleted_at is not null or body is not null);

-- End-to-end encryption: one row per member per key version.
-- wrapped_key = the conversation key, encrypted for this member. The server cannot read it.
create table if not exists public.conversation_keys (
  conversation_id    uuid not null references public.conversations (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  key_version        int not null check (key_version >= 1),
  wrapped_key        text not null,
  wrapper_public_key jsonb not null,
  wrapped_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  primary key (conversation_id, user_id, key_version)
);

-- Public key the row was wrapped for. If the member's profile key changes (new browser),
-- the row is stale and any member holding the key can re-share it.
alter table public.conversation_keys add column if not exists recipient_public_key jsonb;

-- Voice and video calls: a call row plus WebRTC signals (offer, answer, ICE candidates)
create table if not exists public.call_sessions (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  caller_id       uuid not null references public.profiles (id) on delete cascade,
  callee_id       uuid not null references public.profiles (id) on delete cascade,
  media           text not null check (media in ('audio', 'video')),
  status          text not null default 'ringing'
                  check (status in ('ringing', 'accepted', 'declined', 'ended', 'missed', 'failed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (caller_id <> callee_id)
);

create table if not exists public.call_signals (
  id        uuid primary key default gen_random_uuid(),
  call_id   uuid not null references public.call_sessions (id) on delete cascade,
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user   uuid not null references public.profiles (id) on delete cascade,
  kind      text not null check (kind in ('offer', 'answer', 'ice')),
  payload   jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists call_signals_to_idx on public.call_signals (to_user, call_id);


-- ---------------------------------------------------------------------
-- 3. FUNCTIONS AND TRIGGERS
-- ---------------------------------------------------------------------

-- Creates the profile on sign up. Reads the name and the Google photo (avatar_url / picture).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, name, profile_image)
  values (
    new.id,
    left(coalesce(
      nullif(trim(meta ->> 'name'), ''),
      nullif(trim(meta ->> 'full_name'), ''),
      nullif(split_part(new.email, '@', 1), ''),
      'New user'
    ), 80),
    nullif(coalesce(meta ->> 'avatar_url', meta ->> 'picture'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists call_sessions_touch_updated_at on public.call_sessions;
create trigger call_sessions_touch_updated_at
  before update on public.call_sessions
  for each row execute function public.touch_updated_at();

create or replace function public.bump_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_bump_conversation on public.messages;
create trigger messages_bump_conversation
  after insert on public.messages
  for each row execute function public.bump_conversation();

-- True when the current user is a member of the conversation.
create or replace function public.is_member(conv_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = conv_id
      and m.user_id = auth.uid()
  );
$$;

-- One-to-one chat: reuse the existing conversation, or create it.
create or replace function public.create_direct_conversation(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_conv uuid;
begin
  if v_me is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if other_user is null or other_user = v_me then
    raise exception 'Choose a different person to chat with.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = other_user) then
    raise exception 'That user does not exist.';
  end if;

  select c.id
    into v_conv
    from public.conversations c
   where c.is_group = false
     and (select count(*) from public.conversation_members m
           where m.conversation_id = c.id) = 2
     and exists (select 1 from public.conversation_members m1
                  where m1.conversation_id = c.id and m1.user_id = v_me)
     and exists (select 1 from public.conversation_members m2
                  where m2.conversation_id = c.id and m2.user_id = other_user)
   limit 1;

  if v_conv is not null then
    return v_conv;
  end if;

  insert into public.conversations (is_group, created_by)
  values (false, v_me)
  returning id into v_conv;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_conv, v_me, 'member'), (v_conv, other_user, 'member');

  return v_conv;
end;
$$;

-- Group chat: the creator becomes admin. Requires at least one other person.
create or replace function public.create_group(p_title text, p_members uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_title text := left(trim(coalesce(p_title, '')), 80);
  v_conv  uuid;
  v_count int;
begin
  if v_me is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if char_length(v_title) = 0 then
    raise exception 'Please enter a group name.';
  end if;

  insert into public.conversations (is_group, title, created_by)
  values (true, v_title, v_me)
  returning id into v_conv;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (v_conv, v_me, 'admin');

  insert into public.conversation_members (conversation_id, user_id, role)
  select v_conv, u.id, 'member'
    from public.profiles u
   where u.id = any (coalesce(p_members, '{}'::uuid[]))
     and u.id <> v_me
  on conflict (conversation_id, user_id) do nothing;

  select count(*) into v_count
    from public.conversation_members m
   where m.conversation_id = v_conv;

  if v_count < 2 then
    raise exception 'Add at least one other person to the group.';
  end if;

  return v_conv;
end;
$$;

-- Admins add people to a group. New members get the current key from a member who already has it.
create or replace function public.add_group_members(p_conversation uuid, p_members uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_added int;
begin
  if v_me is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation and c.is_group) then
    raise exception 'This is not a group.';
  end if;
  if not exists (select 1 from public.conversation_members m
                  where m.conversation_id = p_conversation and m.user_id = v_me and m.role = 'admin') then
    raise exception 'Only group admins can add members.' using errcode = '42501';
  end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  select distinct p_conversation, u.id, 'member'
    from public.profiles u
   where u.id = any (coalesce(p_members, '{}'::uuid[]))
     and u.id <> v_me
  on conflict (conversation_id, user_id) do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end;
$$;

-- Admins remove a member, or a member leaves (p_user = self).
-- Clients rotate the group key BEFORE calling this, so removed members cannot read new messages.
create or replace function public.remove_group_member(p_conversation uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       uuid := auth.uid();
  v_is_admin boolean;
  v_role     text;
  v_next     uuid;
begin
  if v_me is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation and c.is_group) then
    raise exception 'This is not a group.';
  end if;

  select exists (select 1 from public.conversation_members m
                  where m.conversation_id = p_conversation and m.user_id = v_me and m.role = 'admin')
    into v_is_admin;

  if not (v_is_admin or v_me = p_user) then
    raise exception 'Only group admins can remove members.' using errcode = '42501';
  end if;

  select m.role into v_role
    from public.conversation_members m
   where m.conversation_id = p_conversation and m.user_id = p_user;

  if v_role is null then
    raise exception 'That person is not in this group.';
  end if;

  delete from public.conversation_keys
   where conversation_id = p_conversation and user_id = p_user;

  delete from public.conversation_members
   where conversation_id = p_conversation and user_id = p_user;

  -- Keep at least one admin in the group.
  if not exists (select 1 from public.conversation_members m
                  where m.conversation_id = p_conversation and m.role = 'admin') then
    select m.user_id into v_next
      from public.conversation_members m
     where m.conversation_id = p_conversation
     order by m.joined_at, m.user_id
     limit 1;

    if v_next is not null then
      update public.conversation_members
         set role = 'admin'
       where conversation_id = p_conversation and user_id = v_next;
    end if;
  end if;
end;
$$;

-- Latest key version for a conversation (0 = no keys yet). Returns only a number.
create or replace function public.get_conversation_key_version(p_conversation uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_member(p_conversation) then
    return null;
  end if;
  return (select coalesce(max(k.key_version), 0)
            from public.conversation_keys k
           where k.conversation_id = p_conversation);
end;
$$;

-- Which members already hold a given key version (user ids only).
create or replace function public.get_key_holders(p_conversation uuid, p_version int)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select k.user_id
    from public.conversation_keys k
   where k.conversation_id = p_conversation
     and k.key_version = p_version
     and public.is_member(p_conversation);
$$;

-- Key rows that were wrapped for an older public key of the member (returns user id and version).
create or replace function public.get_stale_key_rows(p_conversation uuid)
returns table (user_id uuid, key_version int)
language sql
stable
security definer
set search_path = public
as $$
  select k.user_id, k.key_version
    from public.conversation_keys k
    join public.profiles p
      on p.id = k.user_id
   where k.conversation_id = p_conversation
     and public.is_member(p_conversation)
     and k.recipient_public_key is distinct from p.public_key;
$$;

-- A member who holds key version p_version re-wraps it for another member's current public key.
-- The server never sees the key itself, only the new wrapped copy.
create or replace function public.rewrap_key(
  p_conversation        uuid,
  p_user                uuid,
  p_version             int,
  p_wrapped_key         text,
  p_wrapper_public_key  jsonb,
  p_recipient_public_key jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not public.is_member(p_conversation) then
    raise exception 'You are not a member of this conversation.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.conversation_members m
                  where m.conversation_id = p_conversation and m.user_id = p_user) then
    raise exception 'That person is not in this conversation.';
  end if;
  if not exists (select 1 from public.conversation_keys k
                  where k.conversation_id = p_conversation and k.user_id = v_me and k.key_version = p_version) then
    raise exception 'You do not hold this key version.' using errcode = '42501';
  end if;
  if (select pr.public_key from public.profiles pr where pr.id = p_user)
       is distinct from p_recipient_public_key then
    raise exception 'The recipient key changed. Try again.';
  end if;

  update public.conversation_keys
     set wrapped_key = p_wrapped_key,
         wrapper_public_key = p_wrapper_public_key,
         recipient_public_key = p_recipient_public_key,
         wrapped_by = v_me,
         created_at = now()
   where conversation_id = p_conversation
     and user_id = p_user
     and key_version = p_version;

  if not found then
    raise exception 'No key row to replace.';
  end if;
end;
$$;

-- Chat list: one row per conversation, with names, the latest message, unread count and role.
-- Runs as the caller (SECURITY INVOKER), so RLS applies.
drop function if exists public.get_my_conversations();

create or replace function public.get_my_conversations()
returns table (
  conversation_id   uuid,
  is_group          boolean,
  display_name      text,
  display_avatar    text,
  other_user_id     uuid,
  other_last_seen   timestamptz,
  my_role           text,
  last_body         text,
  last_is_encrypted boolean,
  last_key_version  int,
  last_kind         text,
  last_deleted      boolean,
  last_message_at   timestamptz,
  unread_count      bigint
)
language sql
stable
set search_path = public
as $$
  select
    c.id,
    c.is_group,
    case when c.is_group then c.title else coalesce(p.name, 'Unknown user') end,
    case when c.is_group then null else p.profile_image end,
    case when c.is_group then null else p.id end,
    case when c.is_group then null else p.last_seen_at end,
    me.role,
    lm.body,
    lm.is_encrypted,
    lm.key_version,
    lm.kind,
    lm.deleted_at is not null,
    c.last_message_at,
    (
      select count(*)
        from public.messages m
       where m.conversation_id = c.id
         and m.sender_id <> auth.uid()
         and m.deleted_at is null
         and m.created_at > me.last_read_at
    )
  from public.conversation_members me
  join public.conversations c
    on c.id = me.conversation_id
  left join lateral (
    select om.user_id
      from public.conversation_members om
     where om.conversation_id = c.id
       and om.user_id <> auth.uid()
       and not c.is_group
     limit 1
  ) other on true
  left join public.profiles p
    on p.id = other.user_id
  left join lateral (
    select m2.body, m2.is_encrypted, m2.key_version, m2.kind, m2.deleted_at
      from public.messages m2
     where m2.conversation_id = c.id
     order by m2.created_at desc
     limit 1
  ) lm on true
  where me.user_id = auth.uid()
  order by c.last_message_at desc;
$$;

create or replace function public.mark_conversation_read(conv_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversation_members
     set last_read_at = now()
   where conversation_id = conv_id
     and user_id = auth.uid();
$$;

-- Sender unsends a message. Content is removed for everyone.
-- Returns the storage path of the file (if any) so the client can delete the object.
create or replace function public.unsend_message(p_message uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_path text;
begin
  if v_me is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select m.attachment_path
    into v_path
    from public.messages m
   where m.id = p_message
     and m.sender_id = v_me
     and m.deleted_at is null
   for update;

  if not found then
    raise exception 'This message cannot be unsent.';
  end if;

  update public.messages
     set deleted_at = now(),
         body = null
   where id = p_message;

  return v_path;
end;
$$;

-- Updates the caller's last seen time (called every minute by the dashboard).
create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set last_seen_at = now()
   where id = auth.uid();
$$;


-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.profiles             enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.conversation_keys    enable row level security;
alter table public.call_sessions        enable row level security;
alter table public.call_signals         enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "conversations_select_members" on public.conversations;
create policy "conversations_select_members" on public.conversations
  for select to authenticated using (public.is_member(id));

drop policy if exists "members_select_same_conversation" on public.conversation_members;
create policy "members_select_same_conversation" on public.conversation_members
  for select to authenticated using (public.is_member(conversation_id));

drop policy if exists "messages_select_members" on public.messages;
create policy "messages_select_members" on public.messages
  for select to authenticated using (public.is_member(conversation_id));

drop policy if exists "messages_insert_members" on public.messages;
create policy "messages_insert_members" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(conversation_id));

-- Users only read their own wrapped keys. They can only wrap keys for members, and only as themselves.
drop policy if exists "keys_select_own" on public.conversation_keys;
create policy "keys_select_own" on public.conversation_keys
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "keys_insert_wrapped_by_me" on public.conversation_keys;
create policy "keys_insert_wrapped_by_me" on public.conversation_keys
  for insert to authenticated
  with check (
    wrapped_by = auth.uid()
    and public.is_member(conversation_id)
    and exists (select 1 from public.conversation_members m
                 where m.conversation_id = conversation_keys.conversation_id
                   and m.user_id = conversation_keys.user_id)
  );

-- Calls: only the two participants can see a call, and only the caller can start one.
drop policy if exists "calls_select_participants" on public.call_sessions;
create policy "calls_select_participants" on public.call_sessions
  for select to authenticated using (caller_id = auth.uid() or callee_id = auth.uid());

drop policy if exists "calls_insert_caller" on public.call_sessions;
create policy "calls_insert_caller" on public.call_sessions
  for insert to authenticated
  with check (
    caller_id = auth.uid()
    and public.is_member(conversation_id)
    and exists (select 1 from public.conversation_members m
                 where m.conversation_id = call_sessions.conversation_id
                   and m.user_id = call_sessions.callee_id)
  );

drop policy if exists "calls_update_participants" on public.call_sessions;
create policy "calls_update_participants" on public.call_sessions
  for update to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid())
  with check (caller_id = auth.uid() or callee_id = auth.uid());

-- Signals: the recipient reads them; only a call participant can send them, to the other participant.
drop policy if exists "signals_select_recipient" on public.call_signals;
drop policy if exists "signals_select_participant" on public.call_signals;
create policy "signals_select_participant" on public.call_signals
  for select to authenticated using (to_user = auth.uid() or from_user = auth.uid());

drop policy if exists "signals_insert_participant" on public.call_signals;
create policy "signals_insert_participant" on public.call_signals
  for insert to authenticated
  with check (
    from_user = auth.uid()
    and to_user <> auth.uid()
    and exists (
      select 1 from public.call_sessions s
       where s.id = call_signals.call_id
         and s.caller_id in (auth.uid(), call_signals.to_user)
         and s.callee_id in (auth.uid(), call_signals.to_user)
         and s.status in ('ringing', 'accepted')
    )
  );

drop policy if exists "signals_delete_participant" on public.call_signals;
create policy "signals_delete_participant" on public.call_signals
  for delete to authenticated using (from_user = auth.uid() or to_user = auth.uid());


-- ---------------------------------------------------------------------
-- 5. PRIVILEGES (column-level, on top of RLS)
-- ---------------------------------------------------------------------

revoke all on public.profiles, public.conversations, public.conversation_members,
              public.messages, public.conversation_keys,
              public.call_sessions, public.call_signals
  from anon, authenticated;

grant select on public.profiles, public.conversations, public.conversation_members,
                public.messages, public.conversation_keys,
                public.call_sessions, public.call_signals
  to authenticated;

grant update (name, bio, profile_image, public_key) on public.profiles to authenticated;

grant insert (conversation_id, sender_id, body, is_encrypted, key_version, kind, attachment_path)
  on public.messages to authenticated;

grant insert (conversation_id, user_id, key_version, wrapped_key, wrapper_public_key, recipient_public_key, wrapped_by)
  on public.conversation_keys to authenticated;

grant insert (conversation_id, caller_id, callee_id, media) on public.call_sessions to authenticated;
grant update (status) on public.call_sessions to authenticated;

grant insert (call_id, from_user, to_user, kind, payload) on public.call_signals to authenticated;
grant delete on public.call_signals to authenticated;

revoke execute on function
  public.is_member(uuid),
  public.create_direct_conversation(uuid),
  public.create_group(text, uuid[]),
  public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid),
  public.get_conversation_key_version(uuid),
  public.get_key_holders(uuid, int),
  public.get_my_conversations(),
  public.mark_conversation_read(uuid),
  public.unsend_message(uuid),
  public.touch_last_seen(),
  public.get_stale_key_rows(uuid),
  public.rewrap_key(uuid, uuid, int, text, jsonb, jsonb)
  from public, anon;

grant execute on function
  public.is_member(uuid),
  public.create_direct_conversation(uuid),
  public.create_group(text, uuid[]),
  public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid),
  public.get_conversation_key_version(uuid),
  public.get_key_holders(uuid, int),
  public.get_my_conversations(),
  public.mark_conversation_read(uuid),
  public.unsend_message(uuid),
  public.touch_last_seen(),
  public.get_stale_key_rows(uuid),
  public.rewrap_key(uuid, uuid, int, text, jsonb, jsonb)
  to authenticated;

revoke execute on function
  public.handle_new_user(),
  public.bump_conversation(),
  public.touch_updated_at()
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. REALTIME (new messages, edits, calls, signals)
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['messages', 'conversation_members', 'conversation_keys', 'call_sessions', 'call_signals'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- 7. STORAGE
-- ---------------------------------------------------------------------

-- Profile pictures: public bucket, each user writes only inside their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_insert_own_folder" on storage.objects;
create policy "avatars_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_update_own_folder" on storage.objects;
create policy "avatars_update_own_folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_delete_own_folder" on storage.objects;
create policy "avatars_delete_own_folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Chat files: private bucket with encrypted contents. Path = <conversation_id>/<random>.bin
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', false, 26214400)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

drop policy if exists "chat_files_select_members" on storage.objects;
create policy "chat_files_select_members" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-files'
    and exists (select 1 from public.conversation_members m
                 where m.user_id = auth.uid()
                   and m.conversation_id::text = (storage.foldername(storage.objects.name))[1])
  );

drop policy if exists "chat_files_insert_members" on storage.objects;
create policy "chat_files_insert_members" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-files'
    and exists (select 1 from public.conversation_members m
                 where m.user_id = auth.uid()
                   and m.conversation_id::text = (storage.foldername(storage.objects.name))[1])
  );

-- Only the sender of the message can delete its file (used when unsending).
drop policy if exists "chat_files_delete_sender" on storage.objects;
create policy "chat_files_delete_sender" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-files'
    and exists (select 1 from public.messages m
                 where m.attachment_path = storage.objects.name
                   and m.sender_id = auth.uid())
  );


-- ---------------------------------------------------------------------
-- 8. BACKFILL (users who signed up before this schema)
-- ---------------------------------------------------------------------

insert into public.profiles (id, name, profile_image)
select
  u.id,
  left(coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(u.email, '@', 1), ''),
    'New user'
  ), 80),
  nullif(coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'), '')
from auth.users u
on conflict (id) do nothing;
