import assert from "node:assert/strict";
import test from "node:test";
import { proxyRecords } from "../src/server/records.mjs";
const env = { FORMA_BACKEND_URL: "http://127.0.0.1:8765" };
function write(extra = {}, data = { title: "Synthetic note" }) {
  return new Request("http://127.0.0.1:3000/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extra },
    body: JSON.stringify(data),
  });
}
test("foreign origins and nonlocal hosts fail before any backend call", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({});
  };
  for (const origin of [
    "https://evil.example",
    "null",
    "http://127.0.0.1:4000",
  ]) {
    const result = await proxyRecords(
      write({ Origin: origin }),
      "records",
      fetcher,
      env,
    );
    assert.equal(result.status, 403);
    assert.equal((await result.json()).error_code, "records.error.origin");
  }
  assert.equal(
    (
      await proxyRecords(
        new Request("http://evil.example/api/records"),
        "records",
        fetcher,
        env,
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
});
test("same-origin bridge strips credentials and forwards only fixed API target and validated body", async () => {
  const input = {
    title: "Synthetic title",
    details: "Text from a customer is data, never code",
  };
  const result = await proxyRecords(
    write(
      {
        Origin: "http://127.0.0.1:3000",
        Cookie: "private-session=secret",
        Authorization: "Bearer secret",
        "X-Target": "https://evil.example",
      },
      input,
    ),
    "records",
    async (url, options) => {
      assert.equal(url, "http://127.0.0.1:8765/api/records");
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.deepEqual(options.headers, { "Content-Type": "application/json" });
      assert.deepEqual(
        JSON.parse(new TextDecoder().decode(options.body)),
        input,
      );
      return Response.json(
        { id: 1, ...input, status: "todo", revision: 1 },
        { status: 201 },
      );
    },
    env,
  );
  assert.equal(result.status, 201);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal((await result.json()).title, input.title);
});
test("oversized and non-JSON writes are rejected without forwarding", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({});
  };
  assert.equal(
    (
      await proxyRecords(
        write({}, { details: "x".repeat(17000) }),
        "records",
        fetcher,
        env,
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await proxyRecords(
        write({ "Content-Type": "text/plain" }),
        "records",
        fetcher,
        env,
      )
    ).status,
    415,
  );
  assert.equal(calls, 0);
});
test("stale response preserves stable code and drops backend diagnostic contents", async () => {
  const request = new Request("http://localhost:3000/api/records/1", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify({ status: "done", expected_revision: 1 }),
  });
  const result = await proxyRecords(
    request,
    "records/1",
    async () =>
      Response.json(
        {
          error_code: "records.error.stale",
          error_params: { secret: "no" },
          message: "secret trace",
        },
        { status: 409 },
      ),
    env,
  );
  assert.equal(result.status, 409);
  assert.deepEqual(await result.json(), {
    error_code: "records.error.stale",
    error_params: {},
  });
});
test("backend target and resources cannot be redirected through user paths", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({});
  };
  for (const url of [
    "https://evil.example",
    "http://user:password@localhost:8765",
    "http://127.0.0.1:8765/other",
    "http://127.0.0.1:8765?secret=1",
  ]) {
    assert.equal(
      (
        await proxyRecords(
          new Request("http://localhost:3000/api/records"),
          "records",
          fetcher,
          { FORMA_BACKEND_URL: url },
        )
      ).status,
      503,
    );
  }
  assert.equal(
    (
      await proxyRecords(
        new Request("http://localhost:3000/api/records"),
        "records/../health",
        fetcher,
        env,
      )
    ).status,
    405,
  );
  assert.equal(calls, 0);
});
test("unavailable or malformed upstream returns a generic request failure", async () => {
  for (const fetcher of [
    async () => {
      throw new Error("private filesystem path");
    },
    async () => new Response("private stack"),
  ]) {
    const result = await proxyRecords(
      new Request("http://localhost:3000/api/records"),
      "records",
      fetcher,
      env,
    );
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), {
      error_code: "records.error.request",
      error_params: {},
    });
  }
});

test("actual local Host wins over Next internal hostname without trusting forwarded headers", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({ id: 1 }, { status: 201 });
  };
  function request(host, origin, extra = {}) {
    return new Request("http://localhost:3000/api/records", {
      method: "POST",
      headers: {
        Host: host,
        Origin: origin,
        "Content-Type": "application/json",
        ...extra,
      },
      body: JSON.stringify({ title: "Actual served origin" }),
    });
  }
  assert.equal(
    (
      await proxyRecords(
        request("127.0.0.1:3000", "http://127.0.0.1:3000"),
        "records",
        fetcher,
        env,
      )
    ).status,
    201,
  );
  for (const [host, origin] of [
    ["evil.example", "http://evil.example"],
    ["127.0.0.1:3000", "http://localhost:3000"],
    ["127.0.0.1:3000@evil.example", "http://evil.example"],
    ["localhost:99999", "http://localhost:99999"],
  ]) {
    assert.equal(
      (
        await proxyRecords(
          request(host, origin, {
            "X-Forwarded-Host": "localhost:3000",
            "X-Forwarded-Proto": "https",
          }),
          "records",
          fetcher,
          env,
        )
      ).status,
      403,
    );
  }
  assert.equal(calls, 1);
});
