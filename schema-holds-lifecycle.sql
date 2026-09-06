-- Cancel an active hold and return the units. Called by the Bolna webhook
-- when the bank reports zero units or refuses to hold on the call.
create or replace function cancel_hold_atomic(
  p_request_id uuid, p_bank_id uuid, p_group text, p_reason text
) returns jsonb language plpgsql as $$
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

grant execute on function cancel_hold_atomic to service_role;

-- Mark a hold collected. No stock change: place_hold_atomic already
-- decremented. This stops the expiry sweep returning units that physically
-- left the building. Refuses if the hold is not active, so blood cannot be
-- collected twice.
create or replace function fulfil_hold(p_hold_id uuid)
returns jsonb language plpgsql as $$
declare v_hold holds%rowtype;
begin
  select * into v_hold from holds where id = p_hold_id for update;

  if v_hold.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_hold.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'not_active',
      'status', v_hold.status);
  end if;

  update holds set status = 'fulfilled', released = true where id = p_hold_id;

  return jsonb_build_object('ok', true, 'hold_id', p_hold_id,
    'units', v_hold.units, 'bank_id', v_hold.bank_id);
end; $$;

-- anon for the demo's Mark-collected button. Production would put this
-- behind auth: it is currently callable by anyone holding the public key.
grant execute on function fulfil_hold to anon, authenticated, service_role;