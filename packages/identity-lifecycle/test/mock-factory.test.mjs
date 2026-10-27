import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../../../blueprints/application/modules/identity/runtime/node/application.mjs";
test("mock runtime refuses optimized serving before configuration, DB or listeners", async () => {
  for (const dev of [false, undefined])
    await assert.rejects(
      createApplication({
        dev,
        env: {
          FORMA_MOCK_OAUTH: "1",
          FORMA_ENVIRONMENT: "local",
          NODE_ENV: "development",
        },
      }),
      /requires dev:true/,
    );
});
