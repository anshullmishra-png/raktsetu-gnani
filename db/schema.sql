-- RaktSetu schema. Idempotent: safe to run more than once.
-- All data in this project is synthetic. See seed.sql.
--
-- Access model (Neon Postgres; no database key ever reaches the browser):
--   * The Vercel API connects as the database owner for privileged work
--     (dispatch, voice pipeline, approvals, admin).
--   * Everything the public pages do goes through /api/public, which runs each
--     statement after SET LOCAL ROLE raktsetu_public. That role can only
--       - read operational demo tables (banks, stock, requests, call log, proposals, holds, settings)
--       - insert a donor or a replacement pledge with a consent timestamp (never read them back)
--       - call fulfil_hold / mark_replacement_offered
--     so the limits are enforced by Postgres grants and RLS, not by API code.
--   * The donor register, audit log, voice transcripts and eval runs are
--     unreachable for that role.

create extension if not exists pgcrypto;

do $
begin
  if not exists (select 1 from pg_roles where rolname = 'raktsetu_public') then
    create role raktsetu_public nologin;
  end if;
  -- let the owner SET ROLE to it (the explicit SET option is needed on PG16+)
  execute format('grant raktsetu_public to %I with set true', current_user);
end $;
grant usage on schema public to raktsetu_public;

-- ───────────────────────── core tables ─────────────────────────

create table if not exists hospitals (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique,
  lat  double precision not null,
  lng  double precision not null
);

create table if not exists blood_banks (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  district     text not null,
  lat          double precision not null,
  lng          double precision not null,
  -- GUARDRAIL 1: only obviously fictional numbers are storable. Indian
  -- numbers never start 00000, so nothing in this column can be dialled.
  phone        text not null check (phone ~ '^\+91 00000 0[0-9]{4}$'),
  pickup_hours text not null default '24 hours',
  -- GUARDRAIL 1: voice sessions may only target demo banks (trigger below).
  is_demo      boolean not null default false
);

create table if not exists stock (
  bank_id      uuid not null references blood_banks(id) on delete cascade,
  blood_group  text not null check (blood_group in ('O-','O+','A-','A+','B-','B+','AB-','AB+')),
  units        int  not null check (units >= 0),
  -- Per-group floor. Rarer groups get a higher floor. Judgement, not evidence.
  min_units    int  not null default 2,
  last_updated timestamptz not null default now(),
  primary key (bank_id, blood_group)
);

-- GUARDRAIL 3: a request carries a blood group, a unit count and a hospital
-- from the fixed list. There is no patient column and no free-text column.
create table if not exists requests (
  id                  uuid primary key default gen_random_uuid(),
  hospital            text not null references hospitals(name),
  lat                 double precision not null,
  lng                 double precision not null,
  blood_group         text not null check (blood_group in ('O-','O+','A-','A+','B-','B+','AB-','AB+')),
  units_needed        int  not null check (units_needed between 1 and 10),
  urgency             text not null default 'critical' check (urgency in ('critical','urgent','routine')),
  status              text not null default 'open' check (status in ('open','resolved','incomplete')),
  replacement_offered boolean not null default false,
  created_at          timestamptz not null default now()
);

create table if not exists call_log (
  id            bigint generated always as identity primary key,
  request_id    uuid not null references requests(id) on delete cascade,
  bank_id       uuid references blood_banks(id),
  event         text not null check (event in ('system','found','calling','confirmed','partial',
                  'declined','no_answer','proposed','voice','refused','held','cancelled')),
  message       text not null,
  units_offered int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists call_log_request_idx on call_log (request_id, id);

-- GUARDRAIL 4: the model and the voice pipeline can only write proposals.
create table if not exists hold_proposals (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references requests(id) on delete cascade,
  bank_id     uuid not null references blood_banks(id),
  blood_group text not null check (blood_group in ('O-','O+','A-','A+','B-','B+','AB-','AB+')),
  units       int  not null check (units between 1 and 10),
  source      text not null check (source in ('agent','voice')),
  status      text not null default 'pending' check (status in ('pending','approved','rejected','superseded')),
  decided_by  text check (decided_by in ('hospital','admin','system')),
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- A hold cannot exist without a proposal a human approved: proposal_id is
-- NOT NULL + UNIQUE and a trigger checks the proposal's status.
create table if not exists holds (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references hold_proposals(id),
  request_id  uuid not null references requests(id) on delete cascade,
  bank_id     uuid not null references blood_banks(id),
  blood_group text not null,
  units       int  not null check (units > 0),
  status      text not null default 'active' check (status in ('active','fulfilled','cancelled','expired')),
  released    boolean not null default false,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists holds_active_idx on holds (status, expires_at);

-- A "call" is a browser voice session. No PSTN dialling exists anywhere.
create table if not exists voice_calls (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references requests(id) on delete cascade,
  bank_id          uuid not null references blood_banks(id),
  blood_group      text not null,
  language_code    text not null check (language_code in ('en-IN','hi-IN','kn-IN')),
  -- GUARDRAIL 2: no consent timestamp, no session row, so nothing to attach audio to.
  consent_at       timestamptz not null,
  status           text not null default 'awaiting_audio',
  model            text,
  transcript       text,          -- stored only after PII redaction
  units_reported   int,
  will_hold        boolean,
  collection_hours text,
  off_topic        boolean,
  pii_redacted     boolean,
  needs_review     boolean,
  outcome          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ───────────────────────── donors ─────────────────────────

-- First name only, no phone, no surname: there is no delivery channel, so
-- there is nothing a contact detail would be used for.
create table if not exists donors (
  id           uuid primary key default gen_random_uuid(),
  first_name   text not null check (char_length(first_name) between 1 and 30 and first_name !~ '[0-9@+]'),
  blood_group  text not null check (blood_group in ('O-','O+','A-','A+','B-','B+','AB-','AB+')),
  locality     text,
  lat          double precision,
  lng          double precision,
  last_donated date,
  active       boolean not null default true,
  consent_at   timestamptz,     -- nullable on purpose: the RLS policy, not the form, rejects a row without it
  created_at   timestamptz not null default now()
);

-- No request or patient column, so an alert can never be tied to a case.
create table if not exists donor_alerts (
  id          uuid primary key default gen_random_uuid(),
  donor_id    uuid not null references donors(id) on delete cascade,
  bank_id     uuid not null references blood_banks(id),
  blood_group text not null,
  sent_at     timestamptz not null default now()
);

-- Pledges are credited to a blood bank. Deliberately no request column.
create table if not exists replacement_pledges (
  id               uuid primary key default gen_random_uuid(),
  bank_id          uuid not null references blood_banks(id),
  donor_first_name text not null check (char_length(donor_first_name) between 1 and 30 and donor_first_name !~ '[0-9@+]'),
  blood_group      text not null check (blood_group in ('O-','O+','A-','A+','B-','B+','AB-','AB+')),
  consent_at       timestamptz,
  created_at       timestamptz not null default now()
);

-- ───────────────────────── control and audit ─────────────────────────

-- GUARDRAIL 5: single-row kill switch.
create table if not exists settings (
  id            int primary key default 1 check (id = 1),
  calls_enabled boolean not null default true,
  updated_at    timestamptz not null default now()
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- GUARDRAIL 7: append-only. No foreign keys, so nothing can cascade into it.
create table if not exists audit_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor      text not null,
  event      text not null,
  request_id uuid,
  bank_id    uuid,
  detail     jsonb not null default '{}'::jsonb
);

create or replace function audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end; $$;

drop trigger if exists audit_log_no_change on audit_log;
create trigger audit_log_no_change before update or delete on audit_log
  for each row execute function audit_log_immutable();
drop trigger if exists audit_log_no_truncate on audit_log;
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function audit_log_immutable();

create table if not exists eval_runs (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  run_id             uuid not null,
  clip               text not null,
  source             text not null check (source in ('human_recording','machine_tts')),
  language_code      text not null,
  model              text not null,
  expected_units     int,
  got_units          int,
  expected_hold      boolean,
  got_hold           boolean,
  expected_off_topic boolean,
  got_off_topic      boolean,
  transcript         text,
  pass               boolean not null,
  notes              text
);

-- ───────────────────────── guardrail triggers ─────────────────────────

-- Voice sessions: demo banks only, and never while the kill switch is off.
create or replace function voice_calls_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not (select calls_enabled from settings where id = 1) then
    raise exception 'calls_disabled';
  end if;
  if not exists (select 1 from blood_banks b where b.id = new.bank_id and b.is_demo) then
    raise exception 'bank_not_on_demo_allowlist';
  end if;
  return new;
end; $$;

drop trigger if exists voice_calls_guard_trg on voice_calls;
create trigger voice_calls_guard_trg before insert on voice_calls
  for each row execute function voice_calls_guard();

-- A hold row must point at an approved proposal for the same bank and group.
create or replace function holds_require_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from hold_proposals p
    where p.id = new.proposal_id and p.status = 'approved'
      and p.decided_by in ('hospital','admin')
      and p.bank_id = new.bank_id and p.blood_group = new.blood_group
      and new.units <= p.units
  ) then
    raise exception 'hold_requires_human_approved_proposal';
  end if;
  return new;
end; $$;

drop trigger if exists holds_require_approval_trg on holds;
create trigger holds_require_approval_trg before insert on holds
  for each row execute function holds_require_approval();

-- Audit entries written by the database itself, so no caller can skip them.
create or replace function audit_from_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'settings' then
    if new.calls_enabled is distinct from old.calls_enabled then
      insert into audit_log (actor, event, detail)
      values ('admin', 'kill_switch_changed', jsonb_build_object('calls_enabled', new.calls_enabled));
    end if;
  elsif tg_table_name = 'voice_calls' then
    insert into audit_log (actor, event, request_id, bank_id, detail)
    values ('hospital', 'voice_consent_given', new.request_id, new.bank_id,
      jsonb_build_object('voice_call_id', new.id, 'consent_at', new.consent_at, 'language_code', new.language_code));
  elsif tg_table_name = 'hold_proposals' then
    if tg_op = 'INSERT' then
      insert into audit_log (actor, event, request_id, bank_id, detail)
      values (new.source, 'hold_proposed', new.request_id, new.bank_id,
        jsonb_build_object('proposal_id', new.id, 'blood_group', new.blood_group, 'units', new.units));
    elsif new.status is distinct from old.status then
      insert into audit_log (actor, event, request_id, bank_id, detail)
      values (coalesce(new.decided_by, 'system'), 'proposal_' || new.status, new.request_id, new.bank_id,
        jsonb_build_object('proposal_id', new.id));
    end if;
  elsif tg_table_name = 'holds' then
    if tg_op = 'INSERT' then
      insert into audit_log (actor, event, request_id, bank_id, detail)
      values ('system', 'hold_placed', new.request_id, new.bank_id,
        jsonb_build_object('hold_id', new.id, 'proposal_id', new.proposal_id,
          'blood_group', new.blood_group, 'units', new.units, 'expires_at', new.expires_at));
    elsif new.status is distinct from old.status then
      insert into audit_log (actor, event, request_id, bank_id, detail)
      values ('system', 'hold_' || new.status, new.request_id, new.bank_id,
        jsonb_build_object('hold_id', new.id, 'units', new.units));
    end if;
  elsif tg_table_name = 'donors' then
    insert into audit_log (actor, event, detail)
    values ('donor', 'donor_registered', jsonb_build_object('blood_group', new.blood_group, 'consent_at', new.consent_at));
  elsif tg_table_name = 'replacement_pledges' then
    insert into audit_log (actor, event, bank_id, detail)
    values ('hospital', 'replacement_pledged', new.bank_id,
      jsonb_build_object('blood_group', new.blood_group, 'consent_at', new.consent_at));
  elsif tg_table_name = 'requests' then
    insert into audit_log (actor, event, request_id, detail)
    values ('hospital', 'request_opened', new.id,
      jsonb_build_object('hospital', new.hospital, 'blood_group', new.blood_group, 'units_needed', new.units_needed));
  end if;
  return new;
end; $$;

drop trigger if exists audit_settings on settings;
create trigger audit_settings after update on settings for each row execute function audit_from_trigger();
drop trigger if exists audit_voice_calls on voice_calls;
create trigger audit_voice_calls after insert on voice_calls for each row execute function audit_from_trigger();
drop trigger if exists audit_hold_proposals on hold_proposals;
create trigger audit_hold_proposals after insert or update on hold_proposals for each row execute function audit_from_trigger();
drop trigger if exists audit_holds on holds;
create trigger audit_holds after insert or update on holds for each row execute function audit_from_trigger();
drop trigger if exists audit_donors on donors;
create trigger audit_donors after insert on donors for each row execute function audit_from_trigger();
drop trigger if exists audit_pledges on replacement_pledges;
create trigger audit_pledges after insert on replacement_pledges for each row execute function audit_from_trigger();
drop trigger if exists audit_requests on requests;
create trigger audit_requests after insert on requests for each row execute function audit_from_trigger();

-- ───────────────────────── hold lifecycle ─────────────────────────

-- Human approval IS the hold. Takes a pending proposal, locks it and the
-- stock row, decrements stock and inserts the hold in one transaction.
-- Returns ok:false with a reason instead of throwing.
create or replace function place_hold_atomic(
  p_proposal_id uuid, p_approver text, p_minutes int default 30
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_p     hold_proposals%rowtype;
  v_units int;
  v_grant int;
  v_hold  holds%rowtype;
begin
  if p_approver not in ('hospital','admin') then
    return jsonb_build_object('ok', false, 'reason', 'approver_must_be_human_role');
  end if;
  if not (select calls_enabled from settings where id = 1) then
    return jsonb_build_object('ok', false, 'reason', 'calls_disabled');
  end if;

  select * into v_p from hold_proposals where id = p_proposal_id for update;
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  end if;
  if v_p.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_pending', 'status', v_p.status);
  end if;

  select units into v_units from stock
  where bank_id = v_p.bank_id and blood_group = v_p.blood_group for update;

  if coalesce(v_units, 0) < 1 then
    update hold_proposals set status = 'superseded', decided_by = 'system', decided_at = now()
    where id = v_p.id;
    return jsonb_build_object('ok', false, 'reason', 'no_stock_left');
  end if;

  v_grant := least(v_units, v_p.units);

  update stock set units = units - v_grant
  where bank_id = v_p.bank_id and blood_group = v_p.blood_group;

  update hold_proposals set status = 'approved', decided_by = p_approver, decided_at = now()
  where id = v_p.id;

  insert into holds (proposal_id, request_id, bank_id, blood_group, units, expires_at)
  values (v_p.id, v_p.request_id, v_p.bank_id, v_p.blood_group, v_grant,
          now() + make_interval(mins => p_minutes))
  returning * into v_hold;

  return jsonb_build_object('ok', true, 'hold_id', v_hold.id, 'units', v_grant,
    'bank_id', v_hold.bank_id, 'blood_group', v_hold.blood_group, 'expires_at', v_hold.expires_at);
end; $$;

create or replace function reject_proposal(p_proposal_id uuid, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_p hold_proposals%rowtype;
begin
  select * into v_p from hold_proposals where id = p_proposal_id for update;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'proposal_not_found'); end if;
  if v_p.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_pending', 'status', v_p.status);
  end if;
  update hold_proposals
  set status = case when p_by = 'system' then 'superseded' else 'rejected' end,
      decided_by = p_by, decided_at = now()
  where id = v_p.id;
  return jsonb_build_object('ok', true);
end; $$;

-- Cancel an active hold and return the units. Called by the voice pipeline
-- when the bank says on the session that it cannot supply.
create or replace function cancel_hold_atomic(
  p_request_id uuid, p_bank_id uuid, p_group text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hold holds%rowtype;
begin
  select * into v_hold from holds
  where request_id = p_request_id and bank_id = p_bank_id
    and blood_group = p_group and status = 'active'
  order by created_at desc limit 1
  for update;

  if v_hold.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_active_hold');
  end if;

  update holds set status = 'cancelled', released = true where id = v_hold.id;

  update stock set units = units + v_hold.units
  where bank_id = p_bank_id and blood_group = p_group;

  return jsonb_build_object('ok', true, 'hold_id', v_hold.id,
    'units_returned', v_hold.units, 'cancel_reason', p_reason);
end; $$;

-- Mark a hold collected. No stock change: place_hold_atomic already
-- decremented. Stops the expiry sweep returning units that left the building.
create or replace function fulfil_hold(p_hold_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hold holds%rowtype;
begin
  select * into v_hold from holds where id = p_hold_id for update;
  if v_hold.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_hold.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'not_active', 'status', v_hold.status);
  end if;
  update holds set status = 'fulfilled', released = true where id = p_hold_id;
  return jsonb_build_object('ok', true, 'hold_id', p_hold_id,
    'units', v_hold.units, 'bank_id', v_hold.bank_id);
end; $$;

-- Expiry sweep. Selects on status = 'active', so fulfilled and cancelled
-- holds are structurally invisible to it.
create or replace function release_expired_holds()
returns int language plpgsql security definer set search_path = public as $$
declare v_hold holds%rowtype; v_n int := 0;
begin
  for v_hold in
    select * from holds where status = 'active' and expires_at < now()
    for update skip locked
  loop
    update stock set units = units + v_hold.units
    where bank_id = v_hold.bank_id and blood_group = v_hold.blood_group;
    update holds set status = 'expired', released = true where id = v_hold.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;

create or replace function mark_replacement_offered(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update requests set replacement_offered = true where id = p_request_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into audit_log (actor, event, request_id) values ('hospital', 'replacement_offered', p_request_id);
  return jsonb_build_object('ok', true);
end; $$;

-- ───────────────────────── donor eligibility ─────────────────────────

-- Exact group match (donors give whole blood of their own group), 90 days
-- since last donation, within radius, active, consented, and not alerted in
-- the past 30 days. The rate limit lives in the query so it cannot be skipped.
drop function if exists eligible_donors(text, double precision, double precision, int, int);
create function eligible_donors(
  p_group     text,
  p_lat       double precision,
  p_lng       double precision,
  p_radius_km int default 15,
  p_limit     int default 50
) returns table (
  donor_id uuid, first_name text, blood_group text,
  distance_km numeric, days_since_donation int
) language sql stable security invoker set search_path = public as $$
  select d.id, d.first_name, d.blood_group,
    round((6371 * acos(
      least(1, cos(radians(p_lat)) * cos(radians(d.lat)) *
        cos(radians(d.lng) - radians(p_lng)) +
        sin(radians(p_lat)) * sin(radians(d.lat))
    )))::numeric, 1) as distance_km,
    (current_date - d.last_donated)::int as days_since_donation
  from donors d
  where d.active = true
    and d.consent_at is not null
    and d.blood_group = p_group
    and (d.last_donated is null or d.last_donated <= current_date - 90)
    and d.lat is not null and d.lng is not null
    and not exists (
      select 1 from donor_alerts a
      where a.donor_id = d.id and a.sent_at > now() - interval '30 days'
    )
    and (6371 * acos(least(1, cos(radians(p_lat)) * cos(radians(d.lat)) *
        cos(radians(d.lng) - radians(p_lng)) +
        sin(radians(p_lat)) * sin(radians(d.lat))))) <= p_radius_km
  order by distance_km
  limit p_limit;
$$;

-- Bank-level need only: stock below the per-group floor. No patient, no request.
create or replace view bank_need with (security_invoker = true) as
select s.bank_id, b.name, b.district, b.lat, b.lng,
       s.blood_group, s.units, s.min_units,
       (s.min_units - s.units) as shortfall
from stock s
join blood_banks b on b.id = s.bank_id
where s.units < s.min_units
order by shortfall desc;

-- Refuses unless the bank is genuinely below its floor. Takes a bank and a
-- group only, so it structurally cannot be tied to a patient. Records who
-- would be contacted; nothing is sent.
create or replace function broadcast_donor_alert(
  p_bank_id uuid, p_group text,
  p_radius_km int default 15, p_max_donors int default 20
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_bank record; v_sent int := 0;
begin
  select b.id, b.name, b.lat, b.lng, s.units, s.min_units into v_bank
  from blood_banks b
  join stock s on s.bank_id = b.id and s.blood_group = p_group
  where b.id = p_bank_id;

  if v_bank.id is null then
    return jsonb_build_object('ok', false, 'reason', 'bank_or_stock_not_found');
  end if;
  if v_bank.units >= v_bank.min_units then
    return jsonb_build_object('ok', false, 'reason', 'not_below_threshold',
      'units', v_bank.units, 'min_units', v_bank.min_units);
  end if;

  with picked as (
    select donor_id from eligible_donors(p_group, v_bank.lat, v_bank.lng, p_radius_km, p_max_donors)
  )
  insert into donor_alerts (donor_id, bank_id, blood_group)
  select donor_id, p_bank_id, p_group from picked;
  get diagnostics v_sent = row_count;

  return jsonb_build_object('ok', true, 'bank', v_bank.name,
    'blood_group', p_group, 'shortfall', v_bank.min_units - v_bank.units,
    'donors_alerted', v_sent);
end; $$;

-- ───────────────────────── privileges ─────────────────────────

-- Functions: nothing is callable by the browser unless listed here.
revoke execute on function place_hold_atomic(uuid, text, int)                              from public, raktsetu_public;
revoke execute on function reject_proposal(uuid, text)                                     from public, raktsetu_public;
revoke execute on function cancel_hold_atomic(uuid, uuid, text, text)                      from public, raktsetu_public;
revoke execute on function release_expired_holds()                                         from public, raktsetu_public;
revoke execute on function eligible_donors(text, double precision, double precision, int, int) from public, raktsetu_public;
revoke execute on function broadcast_donor_alert(uuid, text, int, int)                     from public, raktsetu_public;
revoke execute on function audit_from_trigger()                                            from public, raktsetu_public;
revoke execute on function voice_calls_guard()                                             from public, raktsetu_public;
revoke execute on function holds_require_approval()                                        from public, raktsetu_public;


-- Public for the demo's Mark-collected button. It only moves a hold from
-- active to fulfilled and reads nothing. Production would put it behind auth.
grant execute on function fulfil_hold(uuid)              to raktsetu_public;
grant execute on function mark_replacement_offered(uuid) to raktsetu_public;

-- Tables: the public role starts from nothing, then gets the minimum.
revoke all on hospitals, blood_banks, stock, requests, call_log, hold_proposals, holds,
  voice_calls, donors, donor_alerts, replacement_pledges, settings, audit_log, eval_runs
  from raktsetu_public;
revoke all on bank_need from raktsetu_public;

grant select on hospitals, blood_banks, stock, requests, call_log, hold_proposals, holds, settings, bank_need
  to raktsetu_public;
grant insert (first_name, blood_group, locality, lat, lng, last_donated, consent_at) on donors
  to raktsetu_public;
grant insert (bank_id, donor_first_name, blood_group, consent_at) on replacement_pledges
  to raktsetu_public;


-- ───────────────────────── row level security ─────────────────────────

alter table hospitals           enable row level security;
alter table blood_banks         enable row level security;
alter table stock               enable row level security;
alter table requests            enable row level security;
alter table call_log            enable row level security;
alter table hold_proposals      enable row level security;
alter table holds               enable row level security;
alter table voice_calls         enable row level security;
alter table donors              enable row level security;
alter table donor_alerts        enable row level security;
alter table replacement_pledges enable row level security;
alter table settings            enable row level security;
alter table audit_log           enable row level security;
alter table eval_runs           enable row level security;

do $$
declare t text;
begin
  foreach t in array array['hospitals','blood_banks','stock','requests','call_log','hold_proposals','holds','settings']
  loop
    execute format('drop policy if exists demo_read on %I', t);
    execute format('create policy demo_read on %I for select to raktsetu_public using (true)', t);
  end loop;
end $$;

-- Insert-only, and only with a fresh consent timestamp. No select policy
-- exists, so the register cannot be read back by the public role.
drop policy if exists donor_self_register on donors;
create policy donor_self_register on donors for insert to raktsetu_public
  with check (
    consent_at is not null
    and consent_at between now() - interval '10 minutes' and now() + interval '10 minutes'
    and active = true
  );

drop policy if exists pledge_with_consent on replacement_pledges;
create policy pledge_with_consent on replacement_pledges for insert to raktsetu_public
  with check (
    consent_at is not null
    and consent_at between now() - interval '10 minutes' and now() + interval '10 minutes'
  );

-- voice_calls, donor_alerts, audit_log, eval_runs: RLS on, no policies and no
-- grants, so the public role gets nothing. audit_log is additionally protected
-- from update/delete by trigger for every role, including the owner.
