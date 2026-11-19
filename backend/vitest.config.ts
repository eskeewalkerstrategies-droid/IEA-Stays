import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      MAIL_TRANSPORT: "log",
      LOG_LEVEL: "silent",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://ops:ops@localhost:5432/ops_test",
      OPS_MCP_TOKENS: "tester:t0ken,agent-followup:agent-token",
      PUBLIC_URL: "http://test.local",
      FILES_DIR: "/tmp/ew-ops-test-files",
    },
  },
});
