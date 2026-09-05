-- RaktSetu — donor eligibility, thresholds, and broadcast

-- Donors give whole blood of their own group, so this matches exactly.
-- The compatibility matrix applies to bank stock, not to donors.
-- The donor_alerts subquery is the rate limit: one alert per donor per
-- 30 days, enforced here so it cannot be forgotten at the call site.
create or replace function eligible_donors(
  p_group     text,
  p_lat       double precision,
  p_lng       double precision,
  p_radius_km int default 15,
  p_limit     int default 50
) returns table (
  donor_id uuid, name text, phone text,
  blood_group text, distance_km numeric, days_since_donation int
) language sql stable as $$
  select d.id, d.name, d.phone, d.blood_group,
    round((6371 * acos(
      least(1, cos(radians(p_lat)) * cos(radians(d.lat)) *
        cos(radians(d.lng) - radians(p_lng)) +
        sin(radians(p_lat)) * sin(radians(d.lat))
    )))::numeric, 1) as distance_km,
    (current_date - d.last_donated)::int as days_since_donation
  from donors d
  where d.active = true
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

grant execute on function eligible_donors to anon, authenticated;

-- Per-group floor. Rarer groups get a higher floor: fewer compatible donors,
-- harder to source. These starting values are judgement, not evidence.
alter table stock add column if not exists min_units int;

update stock set min_units = case blood_group
  when 'AB-' then 3 when 'B-' then 3 when 'A-' then 3
  when 'O-'  then 4                       -- universal donor, drained fastest
  when 'AB+' then 2 when 'B+' then 2 when 'A+' then 2
  when 'O+'  then 3                       -- highest volume, highest turnover
end
where min_units is null;

alter table stock alter column min_units set not null;
alter table stock alter column min_units set default 2;

-- Which banks are dry is operational information, not public.
create or replace view banks_below_threshold as
select s.bank_id, b.name, b.lat, b.lng,
       s.blood_group, s.units, s.min_units,
       (s.min_units - s.units) as shortfall
from stock s
join blood_banks b on b.id = s.bank_id
where s.units < s.min_units
order by shortfall desc;

grant select on banks_below_threshold to authenticated;

-- Refuses unless the bank is genuinely below its floor. Takes a bank and a
-- group only — structurally cannot be tied to a patient.
create or replace function broadcast_donor_alert(
  p_bank_id uuid, p_group text,
  p_radius_km int default 15, p_max_donors int default 20
) returns jsonb language plpgsql as $$
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
    select donor_id from eligible_donors(
      p_group, v_bank.lat, v_bank.lng, p_radius_km, p_max_donors)
  )
  insert into donor_alerts (donor_id, bank_id, blood_group)
  select donor_id, p_bank_id, p_group from picked;

  get diagnostics v_sent = row_count;

  return jsonb_build_object('ok', true, 'bank', v_bank.name,
    'blood_group', p_group, 'shortfall', v_bank.min_units - v_bank.units,
    'donors_alerted', v_sent);
end; $$;

grant execute on function broadcast_donor_alert to authenticated;
