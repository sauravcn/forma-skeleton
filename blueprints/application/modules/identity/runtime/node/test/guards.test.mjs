import test from "node:test";
import assert from "node:assert/strict";
import { settingsFor } from "../settings.mjs";
import { mailMessages, renderMail } from "../mail-messages.mjs";
import { smtpMail } from "../mail.mjs";
const config = {
  id: "sample-app",
  name: "Sample App",
  auth: { mode: "password", providers: [], twoFactor: true },
};
const env = {
  FORMA_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
  FORMA_ORGANIZATION_ID: "synthetic-org",
  FORMA_IDENTITY_DATABASE_URL:
    "postgres://proof:synthetic@127.0.0.1:5432/proof",
  FORMA_AUTH_SECRET: "d4c09e14b31280a09f7b67cd9aa9223390ab47de6b017b3a",
  DATABASE_PATH: "data/records.sqlite",
  API_PORT: "8765",
};
test("strict child profile and explicit database/settings guards perform no runtime work", () => {
  assert.equal(
    settingsFor({ projectRoot: "/tmp/child", config, env }).appId,
    "sample-app",
  );
  for (const patch of [
    {
      FORMA_AUTH_SECRET:
        "replace-me-with-your-real-secret-at-least-32-characters",
    },
    {
      FORMA_IDENTITY_DATABASE_URL:
        "postgres://proof:synthetic@127.0.0.1:0/proof",
    },
    { DATABASE_PATH: "" },
    { FORMA_PUBLIC_ORIGIN: "https://external.example" },
  ])
    assert.throws(() =>
      settingsFor({
        projectRoot: "/tmp/child",
        config,
        env: { ...env, ...patch },
      }),
    );
  assert.throws(() =>
    settingsFor({
      projectRoot: "/tmp/child",
      config: {
        ...config,
        auth: { mode: "none", providers: [], twoFactor: false },
      },
      env,
    }),
  );
});
test("whole localized mail messages render credentials only in body and reject unknown placeholders", () => {
  const result = renderMail("verification", {
    appName: "Synthetic App",
    url: "https://example.invalid/private-token",
  });
  assert.ok(!result.subject.includes("private-token"));
  assert.ok(result.text.includes("https://example.invalid/private-token"));
  assert.throws(() =>
    mailMessages({
      verification: { subject: "{url}", text: "{url}" },
      reset: { subject: "Reset", text: "{url}" },
    }),
  );
  assert.throws(() =>
    mailMessages({
      verification: { subject: "Verify", text: "{password} {url}" },
      reset: { subject: "Reset", text: "{url}" },
    }),
  );
  assert.throws(() => smtpMail({}, { appName: "Synthetic App" }));
});
