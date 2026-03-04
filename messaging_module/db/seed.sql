-- 10Blocuri Messaging Module Seed Data

BEGIN;

-- 10 building boards: "Bloc 1 — General" ... "Bloc 10 — General"
INSERT INTO msg_conversations (type, title, topic, scope, building_id, created_by)
SELECT
  'board',
  FORMAT('Bloc %s — General', b.n),
  'Discuții generale pentru blocul nostru',
  'building',
  FORMAT('bloc%s', b.n),
  'admin'
FROM GENERATE_SERIES(1, 10) AS b(n)
WHERE NOT EXISTS (
  SELECT 1
  FROM msg_conversations c
  WHERE c.type = 'board'
    AND c.scope = 'building'
    AND c.building_id = FORMAT('bloc%s', b.n)
    AND c.title = FORMAT('Bloc %s — General', b.n)
);

-- 1 neighborhood board: "Cartier — General"
INSERT INTO msg_conversations (type, title, topic, scope, building_id, created_by)
SELECT
  'board',
  'Cartier — General',
  'Discuții pentru toți vecinii din cele 10 blocuri',
  'neighborhood',
  NULL,
  'admin'
WHERE NOT EXISTS (
  SELECT 1
  FROM msg_conversations c
  WHERE c.type = 'board'
    AND c.scope = 'neighborhood'
    AND c.title = 'Cartier — General'
);

-- 10 announcement channels: "Anunțuri Bloc 1" ... "Anunțuri Bloc 10"
INSERT INTO msg_conversations (type, title, topic, scope, building_id, created_by)
SELECT
  'announcement',
  FORMAT('Anunțuri Bloc %s', b.n),
  NULL,
  'building',
  FORMAT('bloc%s', b.n),
  'admin'
FROM GENERATE_SERIES(1, 10) AS b(n)
WHERE NOT EXISTS (
  SELECT 1
  FROM msg_conversations c
  WHERE c.type = 'announcement'
    AND c.scope = 'building'
    AND c.building_id = FORMAT('bloc%s', b.n)
    AND c.title = FORMAT('Anunțuri Bloc %s', b.n)
);

-- For each building board: insert all 16 residents (bloc{N}_apt1..bloc{N}_apt16)
INSERT INTO msg_participants (conversation_id, username, role)
SELECT
  c.id,
  FORMAT('%s_apt%s', c.building_id, a.apartment_no),
  'member'
FROM msg_conversations c
CROSS JOIN GENERATE_SERIES(1, 16) AS a(apartment_no)
WHERE c.type = 'board'
  AND c.scope = 'building'
  AND c.building_id ~ '^bloc(10|[1-9])$'
ON CONFLICT (conversation_id, username) DO NOTHING;

-- For the neighborhood board: insert all 160 residents
INSERT INTO msg_participants (conversation_id, username, role)
SELECT
  c.id,
  FORMAT('bloc%s_apt%s', b.building_no, a.apartment_no),
  'member'
FROM msg_conversations c
CROSS JOIN GENERATE_SERIES(1, 10) AS b(building_no)
CROSS JOIN GENERATE_SERIES(1, 16) AS a(apartment_no)
WHERE c.type = 'board'
  AND c.scope = 'neighborhood'
  AND c.title = 'Cartier — General'
ON CONFLICT (conversation_id, username) DO NOTHING;

-- For all conversations: admin is participant with role='admin'
INSERT INTO msg_participants (conversation_id, username, role)
SELECT
  c.id,
  'admin',
  'admin'
FROM msg_conversations c
ON CONFLICT (conversation_id, username) DO UPDATE
SET role = EXCLUDED.role;

COMMIT;
