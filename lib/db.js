import { Pool } from "pg";
import {
  APARTMENTS_PER_BUILDING,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_RESIDENT_PASSWORD,
  TOTAL_BUILDINGS,
} from "./constants.js";
import { hashPassword } from "./security.js";

function resolveConnectionString() {
  return (
    process.env.PARKING_DB_PATH ||
    process.env.VOTING_DB_PATH ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ""
  );
}

let pool = null;

function getPool() {
  if (pool) return pool;

  const connectionString = resolveConnectionString();
  if (!connectionString) {
    throw new Error(
      "Missing Postgres connection string. Set POSTGRES_URL or DATABASE_URL in Vercel project env vars."
    );
  }

  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  return pool;
}

let initPromise = null;

export async function ensureInitialized() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = getPool();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [7040101]);

      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id BIGSERIAL PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT,
          role TEXT NOT NULL DEFAULT 'resident',
          avizier_permission TEXT NOT NULL DEFAULT 'none',
          building_number INTEGER NOT NULL,
          apartment_number INTEGER NOT NULL,
          phone_number TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await client.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS avizier_permission TEXT NOT NULL DEFAULT 'none';
      `);

      await client.query(`
        UPDATE users
        SET avizier_permission = LOWER(TRIM(COALESCE(avizier_permission, 'none')))
        WHERE avizier_permission IS NULL
           OR TRIM(COALESCE(avizier_permission, '')) = ''
           OR avizier_permission <> LOWER(TRIM(COALESCE(avizier_permission, 'none')));
      `);

      await client.query(`
        UPDATE users
        SET avizier_permission = 'none'
        WHERE avizier_permission NOT IN ('none', 'reprezentant_bloc', 'comitet');
      `);

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'users_avizier_permission_check'
          ) THEN
            ALTER TABLE users
            ADD CONSTRAINT users_avizier_permission_check
            CHECK (avizier_permission IN ('none', 'reprezentant_bloc', 'comitet'));
          END IF;
        END$$;
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS parking_slots (
          id BIGSERIAL PRIMARY KEY,
          building_number INTEGER NOT NULL,
          owner_user_id BIGINT NOT NULL REFERENCES users(id),
          parking_space_number TEXT NOT NULL,
          parking_type TEXT NOT NULL,
          available_from TEXT NOT NULL,
          available_until TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'OPEN',
          reserved_by_user_id BIGINT REFERENCES users(id),
          reserved_at TEXT,
          claim_phone_number TEXT NOT NULL DEFAULT '',
          reservation_from TEXT,
          reservation_until TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_slots_status_building_time ON parking_slots(status, building_number, available_from, available_until);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_slots_owner_status ON parking_slots(owner_user_id, status);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_slots_reserver_status ON parking_slots(reserved_by_user_id, status);"
      );

      await client.query(`
        CREATE TABLE IF NOT EXISTS polls (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          poll_type TEXT NOT NULL,
          created_by BIGINT NOT NULL,
          scope TEXT NOT NULL,
          building_id INTEGER,
          status TEXT NOT NULL DEFAULT 'draft',
          allow_multiple_selections BOOLEAN NOT NULL DEFAULT FALSE,
          show_results_before_close BOOLEAN NOT NULL DEFAULT FALSE,
          requires_quorum BOOLEAN NOT NULL DEFAULT FALSE,
          quorum_percentage INTEGER,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS poll_options (
          id TEXT PRIMARY KEY,
          poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
          label TEXT NOT NULL,
          position INTEGER NOT NULL
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS votes (
          id TEXT PRIMARY KEY,
          poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
          user_id BIGINT NOT NULL,
          option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
          weight INTEGER NOT NULL DEFAULT 1,
          cast_at TEXT NOT NULL
        );
      `);

      await client.query(
        "CREATE UNIQUE INDEX IF NOT EXISTS votes_unique_option ON votes (poll_id, user_id, option_id);"
      );

      await client.query(`
        CREATE TABLE IF NOT EXISTS poll_attachments (
          id TEXT PRIMARY KEY,
          poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
          file_url TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_type TEXT NOT NULL
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS avizier_announcements (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT '',
          scope TEXT NOT NULL,
          building_id INTEGER,
          created_by BIGINT NOT NULL REFERENCES users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (scope IN ('general', 'building'))
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS avizier_attachments (
          id TEXT PRIMARY KEY,
          announcement_id TEXT NOT NULL REFERENCES avizier_announcements(id) ON DELETE CASCADE,
          file_url TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_type TEXT NOT NULL,
          file_size_bytes INTEGER NOT NULL
        );
      `);

      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_avizier_scope_building_created ON avizier_announcements(scope, building_id, created_at DESC);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_avizier_created_by ON avizier_announcements(created_by, created_at DESC);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_avizier_attachments_announcement ON avizier_attachments(announcement_id);"
      );

      await client.query(`
        CREATE TABLE IF NOT EXISTS marketplace_posts (
          id BIGSERIAL PRIMARY KEY,
          owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          listing_type TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'other',
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          price_text TEXT NOT NULL DEFAULT '',
          contact_phone TEXT NOT NULL DEFAULT '',
          pickup_details TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          in_person_only BOOLEAN NOT NULL DEFAULT TRUE,
          claimed_by_user_id BIGINT REFERENCES users(id),
          claimed_at TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TEXT NOT NULL DEFAULT NOW()::text,
          CHECK (listing_type IN ('sale', 'donation', 'lending')),
          CHECK (category IN ('furniture', 'toys', 'clothes', 'brico', 'other')),
          CHECK (status IN ('active', 'sold', 'donated'))
        );
      `);

      await client.query(`
        ALTER TABLE marketplace_posts
        ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other';
      `);

      // Supabase schema note: mirror these ALTERs on the hosted `listings` / `marketplace_posts`
      // table to support lending listings (`max_days`, `is_available`).
      await client.query(`
        ALTER TABLE marketplace_posts
        ADD COLUMN IF NOT EXISTS max_days INTEGER NULL;
      `);

      await client.query(`
        ALTER TABLE marketplace_posts
        ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT TRUE;
      `);

      await client.query(`
        UPDATE marketplace_posts
        SET is_available = TRUE
        WHERE is_available IS NULL;
      `);

      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'marketplace_posts_listing_type_check'
          ) THEN
            ALTER TABLE marketplace_posts
            DROP CONSTRAINT marketplace_posts_listing_type_check;
          END IF;
          ALTER TABLE marketplace_posts
          ADD CONSTRAINT marketplace_posts_listing_type_check
          CHECK (listing_type IN ('sale', 'donation', 'lending'));
        EXCEPTION
          WHEN duplicate_object THEN
            NULL;
        END$$;
      `);

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'marketplace_posts_max_days_check'
          ) THEN
            ALTER TABLE marketplace_posts
            ADD CONSTRAINT marketplace_posts_max_days_check
            CHECK (max_days IS NULL OR (max_days >= 1 AND max_days <= 90));
          END IF;
        END$$;
      `);

      await client.query(`
        UPDATE marketplace_posts
        SET category = 'other'
        WHERE category IS NULL OR TRIM(category) = '';
      `);

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'marketplace_posts_category_check'
          ) THEN
            ALTER TABLE marketplace_posts
            ADD CONSTRAINT marketplace_posts_category_check
            CHECK (category IN ('furniture', 'toys', 'clothes', 'brico', 'other'));
          END IF;
        END$$;
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS marketplace_post_photos (
          id TEXT PRIMARY KEY,
          post_id BIGINT NOT NULL REFERENCES marketplace_posts(id) ON DELETE CASCADE,
          file_url TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_type TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 1
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS contacts_categories (
          id BIGSERIAL PRIMARY KEY,
          icon TEXT NOT NULL DEFAULT '📋',
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS contacts_items (
          id BIGSERIAL PRIMARY KEY,
          category_id BIGINT NOT NULL REFERENCES contacts_categories(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          active BOOLEAN NOT NULL DEFAULT TRUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS rec_categories (
          id BIGSERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          icon VARCHAR(10) NOT NULL DEFAULT '📌',
          display_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS recommendations (
          id BIGSERIAL PRIMARY KEY,
          category_id BIGINT REFERENCES rec_categories(id) ON DELETE SET NULL,
          name VARCHAR(150) NOT NULL,
          area VARCHAR(100),
          phone VARCHAR(30),
          website TEXT NOT NULL DEFAULT '',
          rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
          why TEXT NOT NULL,
          added_by VARCHAR(50) NOT NULL,
          building VARCHAR(20),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await client.query(`
        ALTER TABLE recommendations
        ADD COLUMN IF NOT EXISTS website TEXT NOT NULL DEFAULT '';
      `);

      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_marketplace_posts_status_created ON marketplace_posts(status, created_at DESC);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_marketplace_posts_owner ON marketplace_posts(owner_user_id, created_at DESC);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_marketplace_posts_category_status_created ON marketplace_posts(category, status, created_at DESC);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_marketplace_posts_claimed ON marketplace_posts(claimed_by_user_id);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_marketplace_photos_post_position ON marketplace_post_photos(post_id, position ASC);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_contacts_categories_sort ON contacts_categories(sort_order ASC, id ASC);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_contacts_items_category_sort ON contacts_items(category_id, sort_order ASC, id ASC);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_contacts_items_active ON contacts_items(active);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_rec_categories_display_order ON rec_categories(display_order ASC, id ASC);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_recommendations_created ON recommendations(created_at DESC, id DESC);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_recommendations_category_created ON recommendations(category_id, created_at DESC, id DESC);"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_recommendations_added_by_created ON recommendations(added_by, created_at DESC, id DESC);"
      );

      const recCategoryCountResult = await client.query("SELECT COUNT(*)::int AS count FROM rec_categories");
      const recCategoryCount = Number(recCategoryCountResult.rows[0]?.count || 0);
      if (recCategoryCount === 0) {
        await client.query(
          `
            INSERT INTO rec_categories (icon, name, display_order)
            VALUES
              ('🍽️', 'Food', 1),
              ('☕', 'Coffee', 2),
              ('🏥', 'Medicina', 3),
              ('🛠️', 'Mesteri', 4),
              ('🎓', 'Educatie', 5)
          `
        );
      }

      // Normalize usernames where safe.
      await client.query(`
        UPDATE users AS u
        SET username = LOWER(u.username)
        WHERE u.username <> LOWER(u.username)
          AND NOT EXISTS (
            SELECT 1
            FROM users u2
            WHERE u2.username = LOWER(u.username)
              AND u2.id <> u.id
          );
      `);

      const defaultResidentHash = hashPassword(DEFAULT_RESIDENT_PASSWORD);
      const seedFlag = await client.query(
        "SELECT value FROM app_meta WHERE key = 'default_users_seeded'"
      );
      if (!seedFlag.rowCount || seedFlag.rows[0].value !== "1") {
        await client.query(
          `
            INSERT INTO users (
              username,
              password_hash,
              role,
              building_number,
              apartment_number,
              phone_number
            )
            SELECT
              'bloc' || b::text || '_apt' || a::text,
              $1,
              'resident',
              b,
              a,
              ''
            FROM generate_series(1, $2) AS b
            CROSS JOIN generate_series(1, $3) AS a
            ON CONFLICT (username) DO UPDATE
            SET
              role = 'resident',
              building_number = EXCLUDED.building_number,
              apartment_number = EXCLUDED.apartment_number,
              password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash)
          `,
          [defaultResidentHash, TOTAL_BUILDINGS, APARTMENTS_PER_BUILDING]
        );

        await client.query(
          `
            INSERT INTO app_meta (key, value)
            VALUES ('default_users_seeded', '1')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
          `
        );
      }

      const defaultAdminHash = hashPassword(DEFAULT_ADMIN_PASSWORD);
      await client.query(
        `
          INSERT INTO users (
            username,
            password_hash,
            role,
            building_number,
            apartment_number,
            phone_number
          )
          VALUES ($1, $2, 'admin', 0, 0, '')
          ON CONFLICT (username) DO UPDATE
          SET
            role = 'admin',
            building_number = 0,
            apartment_number = 0,
            password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash)
        `,
        [DEFAULT_ADMIN_USERNAME, defaultAdminHash]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })();

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

export async function query(text, params = []) {
  await ensureInitialized();
  return getPool().query(text, params);
}

export async function withTransaction(run) {
  await ensureInitialized();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
