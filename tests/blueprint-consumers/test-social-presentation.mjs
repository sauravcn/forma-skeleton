import test from "node:test";
import assert from "node:assert/strict";
import {
  configuredMockProviders,
  consumeSocialResult,
  mockRedirectURL,
} from "../../blueprints/application/modules/identity/runtime/frontend/social-contract.mjs";
test("server configuration alone selects five explicitly mock providers", () => {
  assert.deepEqual(configuredMockProviders({}), []);
  const ids = ["google", "facebook", "github", "microsoft", "apple"];
  assert.deepEqual(
    configuredMockProviders({
      providers: ids.map((id) => ({ id, mode: "mock" })),
    }).map((p) => p.id),
    ids,
  );
  for (const providers of [
    null,
    {},
    [{ id: "unknown", mode: "mock" }],
    [{ id: "google", mode: "live" }],
    [
      { id: "google", mode: "mock" },
      { id: "google", mode: "mock" },
    ],
  ])
    assert.throws(() => configuredMockProviders({ providers }));
});
test("redirect accepts only the selected same-origin local mock authorize endpoint", () => {
  const options = {
    origin: "http://127.0.0.1:4011",
    basePath: "/clinic-desk",
    providerId: "google",
  };
  const good =
    options.origin +
    options.basePath +
    "/__mock-oauth/google/authorize?state=synthetic";
  assert.equal(mockRedirectURL({ url: good }, options), good);
  for (const url of [
    "https://outside.invalid/authorize",
    "javascript:alert(1)",
    options.origin + "/clinic-desk/__mock-oauth/apple/authorize",
    options.origin + "/clinic-desk/auth",
    good + "#fragment",
    "http://user:secret@127.0.0.1:4011/clinic-desk/__mock-oauth/google/authorize",
  ])
    assert.throws(() => mockRedirectURL({ url }, options));
  assert.throws(() => mockRedirectURL({}, options));
  assert.throws(() =>
    mockRedirectURL({ url: good }, { ...options, providerId: "constructor" }),
  );
});
test("callback error text never becomes visible content or session authority", () => {
  assert.equal(consumeSocialResult(new URL("http://127.0.0.1/auth")), null);
  assert.equal(
    consumeSocialResult(new URL("http://127.0.0.1/auth?error=access_denied")),
    "cancelled",
  );
  for (const value of ["secret", "<script>", "invalid_state", ""])
    assert.equal(
      consumeSocialResult(
        new URL("http://127.0.0.1/auth?error=" + encodeURIComponent(value)),
      ),
      "error",
    );
});
import {
  identityMessages,
  identityText,
} from "../../blueprints/application/modules/identity-ui/src/messages.js";
test("mock provider localization remains a whole message with its provider placeholder", () => {
  const messages = identityMessages();
  assert.equal(
    identityText(messages.mockProvider, { provider: messages.socialGoogle }),
    "Continue with Google (MOCK)",
  );
  assert.throws(
    () => identityMessages({ mockProvider: "Mock sign in" }),
    /placeholder/,
  );
  assert.equal(
    identityText(
      identityMessages({ mockProvider: "MOCK: {provider}" }).mockProvider,
      { provider: "<external text>" },
    ),
    "MOCK: <external text>",
  );
});
