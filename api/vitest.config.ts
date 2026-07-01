import path from "node:path";
import {
  defineWorkersConfig,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(__dirname, "migrations"),
  );
  return {
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          isolatedStorage: true,
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            bindings: {
              ADMIN_TOKEN: "test-admin-token",
              GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
              BITBUCKET_WEBHOOK_SECRET: "test-webhook-secret",
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
