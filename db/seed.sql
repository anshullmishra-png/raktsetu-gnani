-- RaktSetu seed. EVERYTHING HERE IS FICTIONAL.
-- Bank and hospital names are invented, coordinates are approximate locality
-- centres, and every phone number starts +91 00000, which no real Indian
-- number does. Re-running this file resets stock to the demo starting state.

insert into hospitals (name, lat, lng) values
  ('Namma Arogya Hospital, Chamarajpet',    12.9634, 77.5750),
  ('Suraksha General Hospital, Indiranagar', 12.9784, 77.6408),
  ('Chiguru Children''s Hospital, Jayanagar', 12.9279, 77.5937),
  ('Belaku Trauma Centre, Hebbal',           13.0400, 77.5890),
  ('Sahaya Maternity Home, Whitefield',      12.9750, 77.7400),
  ('Nemmadi District Hospital, Kolar',       13.1340, 78.1320),
  ('Hasiru Rural Hospital, Ramanagara',      12.7250, 77.2850),
  ('Dhairya Community Hospital, Tumakuru',   13.3400, 77.1010)
on conflict (name) do nothing;

-- 55 banks: 40 across Bengaluru, 15 in Kolar, Tumakuru, Ramanagara and Chikkaballapur.
with src (n, locality, district, lat, lng) as (values
  ( 1, 'Indiranagar',       'Bengaluru', 12.9719, 77.6412),
  ( 2, 'Koramangala',       'Bengaluru', 12.9352, 77.6245),
  ( 3, 'Jayanagar',         'Bengaluru', 12.9308, 77.5838),
  ( 4, 'Malleshwaram',      'Bengaluru', 13.0031, 77.5643),
  ( 5, 'Rajajinagar',       'Bengaluru', 12.9915, 77.5545),
  ( 6, 'Basavanagudi',      'Bengaluru', 12.9422, 77.5738),
  ( 7, 'Whitefield',        'Bengaluru', 12.9698, 77.7500),
  ( 8, 'Electronic City',   'Bengaluru', 12.8452, 77.6602),
  ( 9, 'Yelahanka',         'Bengaluru', 13.1007, 77.5963),
  (10, 'Hebbal',            'Bengaluru', 13.0358, 77.5970),
  (11, 'Banashankari',      'Bengaluru', 12.9255, 77.5468),
  (12, 'BTM Layout',        'Bengaluru', 12.9166, 77.6101),
  (13, 'HSR Layout',        'Bengaluru', 12.9116, 77.6389),
  (14, 'Marathahalli',      'Bengaluru', 12.9569, 77.7011),
  (15, 'KR Puram',          'Bengaluru', 13.0075, 77.6959),
  (16, 'Vijayanagar',       'Bengaluru', 12.9719, 77.5350),
  (17, 'Yeshwanthpur',      'Bengaluru', 13.0280, 77.5400),
  (18, 'Peenya',            'Bengaluru', 13.0285, 77.5197),
  (19, 'RT Nagar',          'Bengaluru', 13.0211, 77.5946),
  (20, 'Frazer Town',       'Bengaluru', 12.9982, 77.6126),
  (21, 'Shivajinagar',      'Bengaluru', 12.9857, 77.6057),
  (22, 'Majestic',          'Bengaluru', 12.9767, 77.5713),
  (23, 'Chamarajpet',       'Bengaluru', 12.9592, 77.5637),
  (24, 'Wilson Garden',     'Bengaluru', 12.9484, 77.5968),
  (25, 'Shantinagar',       'Bengaluru', 12.9575, 77.5986),
  (26, 'Ulsoor',            'Bengaluru', 12.9817, 77.6286),
  (27, 'Domlur',            'Bengaluru', 12.9610, 77.6387),
  (28, 'JP Nagar',          'Bengaluru', 12.9063, 77.5857),
  (29, 'Bannerghatta Road', 'Bengaluru', 12.8876, 77.5970),
  (30, 'Kengeri',           'Bengaluru', 12.9177, 77.4838),
  (31, 'RR Nagar',          'Bengaluru', 12.9260, 77.5190),
  (32, 'Nagarbhavi',        'Bengaluru', 12.9600, 77.5100),
  (33, 'Vidyaranyapura',    'Bengaluru', 13.0767, 77.5571),
  (34, 'Jalahalli',         'Bengaluru', 13.0464, 77.5483),
  (35, 'Banaswadi',         'Bengaluru', 13.0104, 77.6482),
  (36, 'Kammanahalli',      'Bengaluru', 13.0159, 77.6379),
  (37, 'HBR Layout',        'Bengaluru', 13.0358, 77.6323),
  (38, 'Bellandur',         'Bengaluru', 12.9304, 77.6784),
  (39, 'Sarjapur Road',     'Bengaluru', 12.9010, 77.6860),
  (40, 'Hennur',            'Bengaluru', 13.0450, 77.6400),
  (41, 'Kolar Town',        'Kolar',           13.1362, 78.1292),
  (42, 'KGF',               'Kolar',           12.9585, 78.2710),
  (43, 'Mulbagal',          'Kolar',           13.1635, 78.3935),
  (44, 'Bangarapet',        'Kolar',           12.9916, 78.1789),
  (45, 'Tumakuru Town',     'Tumakuru',        13.3379, 77.1173),
  (46, 'Tiptur',            'Tumakuru',        13.2580, 76.4770),
  (47, 'Kunigal',           'Tumakuru',        13.0232, 77.0252),
  (48, 'Sira',              'Tumakuru',        13.7411, 76.9042),
  (49, 'Ramanagara Town',   'Ramanagara',      12.7209, 77.2799),
  (50, 'Channapatna',       'Ramanagara',      12.6518, 77.2067),
  (51, 'Magadi',            'Ramanagara',      12.9577, 77.2243),
  (52, 'Kanakapura',        'Ramanagara',      12.5462, 77.4200),
  (53, 'Chikkaballapur Town','Chikkaballapur', 13.4355, 77.7315),
  (54, 'Chintamani',        'Chikkaballapur',  13.4000, 78.0553),
  (55, 'Gauribidanur',      'Chikkaballapur',  13.6110, 77.5170)
)
insert into blood_banks (name, district, lat, lng, phone, pickup_hours, is_demo)
select
  (array['Asha','Jeevan','Sanjeevini','Karuna','Sneha','Namma','Spandana','Chiguru'])[1 + (n % 8)]
    || ' Blood Centre, ' || locality,
  district, lat, lng,
  '+91 00000 0' || lpad(n::text, 4, '0'),
  case when n % 5 in (0, 1, 2) then '24 hours'
       when n % 5 = 3 then '8:00 AM - 8:00 PM'
       else '9:00 AM - 6:00 PM' end,
  true   -- every seeded bank is fictional, so every seeded bank is a demo bank
from src
on conflict (name) do nothing;

-- Stock. Deterministic pseudo-random from a hash of bank name + group, so the
-- demo starts from the same state every time. Rh-negative is deliberately
-- scarce (roughly 6% of the Indian population is Rh-negative): most banks
-- hold none. Around a fifth of listings are more than a day stale.
insert into stock (bank_id, blood_group, units, min_units, last_updated)
select
  b.id, g.grp,
  case
    when g.grp = 'O+'  then 2 + h.r % 14
    when g.grp = 'B+'  then 1 + h.r % 12
    when g.grp = 'A+'  then 1 + h.r % 10
    when g.grp = 'AB+' then h.r % 5
    when h.r < 75 then 0          -- Rh-negative: usually none
    when h.r < 92 then 1
    when h.r < 98 then 2
    else 3
  end,
  case g.grp
    when 'AB-' then 3 when 'B-' then 3 when 'A-' then 3
    when 'O-'  then 4                       -- universal donor, drained fastest
    when 'AB+' then 2 when 'B+' then 2 when 'A+' then 2
    when 'O+'  then 3                       -- highest volume, highest turnover
  end,
  now() - case
    when h.s < 50 then make_interval(mins  => 10 + h.s * 3)        -- fresh: under 3 hours
    when h.s < 80 then make_interval(hours => 6 + (h.s - 50) / 2)  -- 6 to 20 hours
    else               make_interval(hours => 26 + (h.s - 80) * 2) -- 26 to 64 hours: stale
  end
from blood_banks b
cross join (values ('O-'),('O+'),('A-'),('A+'),('B-'),('B+'),('AB-'),('AB+')) as g(grp)
cross join lateral (
  select abs(hashtext(b.name || ':' || g.grp)) % 100 as r,
         abs(hashtext(g.grp || '/' || b.name)) % 100 as s
) h
on conflict (bank_id, blood_group) do update
  set units = excluded.units, min_units = excluded.min_units, last_updated = excluded.last_updated;

-- The story the demo opens with: the portal lists 4 units of O- at this bank,
-- but the listing is 31 hours old. A call is what finds out it ran out yesterday.
update stock s set units = 4, last_updated = now() - interval '31 hours'
from blood_banks b
where b.id = s.bank_id and b.name = 'Karuna Blood Centre, Jayanagar' and s.blood_group = 'O-';

-- And one bank nearby that genuinely has fresh O-, so a dispatch can succeed.
update stock s set units = 3, last_updated = now() - interval '40 minutes'
from blood_banks b
where b.id = s.bank_id and b.name = 'Spandana Blood Centre, Basavanagudi' and s.blood_group = 'O-';

-- A few fictional donors so the eligibility function has rows to work on.
-- First names only. consent_at is set because the seed runs as the owner.
insert into donors (first_name, blood_group, locality, lat, lng, last_donated, consent_at)
select v.first_name, v.blood_group, v.locality, v.lat, v.lng, v.last_donated, now()
from (values
  ('Demoasha',   'O-',  'Jayanagar',    12.9308, 77.5838, current_date - 200),
  ('Demoravi',   'O-',  'Basavanagudi', 12.9422, 77.5738, current_date - 30),   -- too recent: ineligible
  ('Demomeena',  'A+',  'Indiranagar',  12.9719, 77.6412, null::date),
  ('Demokiran',  'B-',  'Hebbal',       13.0358, 77.5970, current_date - 120),
  ('Demofatima', 'O-',  'Kolar Town',   13.1362, 78.1292, current_date - 365),  -- outside a 15 km city radius
  ('Demojohn',   'AB+', 'Whitefield',   12.9698, 77.7500, current_date - 95)
) as v(first_name, blood_group, locality, lat, lng, last_donated)
where not exists (select 1 from donors d where d.first_name = v.first_name);
