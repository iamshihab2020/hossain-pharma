-- Runs once, on first boot of an empty data volume.
--
-- The application connects as nexmarket_app, never as the superuser. A superuser,
-- and any role carrying BYPASSRLS, silently ignores every row-level security
-- policy. That makes tenant isolation look correct in tests while enforcing
-- nothing at all, which is the single most expensive way to get this wrong.
--
-- Neon hands you an owner role (neondb_owner) that DOES carry rolbypassrls.
-- See docs/runbook/neon-setup.md before pointing DATABASE_URL at Neon.

CREATE ROLE nexmarket_app WITH LOGIN PASSWORD 'nexmarket_dev_password' NOBYPASSRLS;

GRANT CONNECT ON DATABASE nexmarket TO nexmarket_app;
GRANT USAGE ON SCHEMA public TO nexmarket_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexmarket_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexmarket_app;

-- Tables created later by the migration role are granted automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexmarket_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO nexmarket_app;
