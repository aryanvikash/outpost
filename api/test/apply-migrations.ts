import { applyD1Migrations, env } from "cloudflare:test";

// Apply D1 migrations to the per-test database before each test file runs.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
