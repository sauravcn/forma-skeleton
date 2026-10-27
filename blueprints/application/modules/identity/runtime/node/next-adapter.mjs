/** Server-only Next composition: no database work or mutable runtime handles at import. */
import { assertIdentityProfile } from "./profile.mjs";
import { loopbackFetch } from "./loopback-fetch.mjs";
const MAX_BODY = 16384;
const local = new Set(["127.0.0.1", "localhost"]);
const stages = new Set([
  "signed-out",
  "enroll",
  "challenge",
  "authenticated",
  "forbidden",
]);
const codes = new Set([
  "records.error.invalid",
  "records.error.notFound",
  "records.error.stale",
  "records.error.origin",
  "records.error.request",
  "identity.error.required",
  "identity.error.forbidden",
  "identity.error.origin",
  "identity.error.unavailable",
]);
export const assertProfile = assertIdentityProfile;
function localOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !local.has(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== value
  )
    throw Error("Invalid fixed loopback target");
  return url;
}
function transport(env) {
  const origin = localOrigin(env.FORMA_PUBLIC_ORIGIN);
  let backend;
  if (env.FORMA_BACKEND_URL) backend = localOrigin(env.FORMA_BACKEND_URL);
  else {
    const port = Number(env.API_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw Error("Explicit backend target required");
    backend = localOrigin(`http://127.0.0.1:${port}`);
  }
  if (backend.port === origin.port)
    throw Error("Separate domain transport required");
  const session = env.FORMA_SESSION_COOKIE_NAME,
    challenge = env.FORMA_CHALLENGE_COOKIE_NAME;
  if (
    ![session, challenge].every(
      (name) =>
        typeof name === "string" && /^[A-Za-z0-9._-]{1,160}$/.test(name),
    ) ||
    session === challenge
  )
    throw Error("Explicit maintained cookie names required");
  return { origin, backend, session, challenge };
}
function selectedCookies(raw, names) {
  if (!raw) return "";
  if (raw.length > 16384) throw Error("Oversized cookie");
  const selected = new Map();
  for (const part of raw.split(";")) {
    const offset = part.indexOf("=");
    if (offset < 0) continue;
    const name = part.slice(0, offset).trim();
    if (!names.includes(name)) continue;
    const value = part.slice(offset + 1).trim();
    if (
      selected.has(name) ||
      !value ||
      value.length > 8192 ||
      !/^[\x21-\x3A\x3C-\x7E]+$/.test(value)
    )
      throw Error("Invalid maintained cookie");
    selected.set(name, value);
  }
  return [...selected].map(([name, value]) => `${name}=${value}`).join("; ");
}
function failure(code, status) {
  return Response.json(
    { error_code: code, error_params: {} },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
export async function identityDescriptor(
  rawCookie,
  { env = process.env, fetcher = loopbackFetch } = {},
) {
  const target = transport(env);
  const cookie = selectedCookies(rawCookie, [target.session, target.challenge]);
  const response = await fetcher(`${target.origin.origin}/api/identity`, {
    headers: cookie ? { Cookie: cookie } : {},
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error("Identity unavailable");
  const value = await response.json();
  if (!value || !stages.has(value.stage))
    throw Error("Invalid identity descriptor");
  return { stage: value.stage };
}
export async function requirePageAccess() {
  const { headers } = await import("next/headers.js");
  const { redirect } = await import("next/navigation.js");
  let descriptor;
  try {
    descriptor = await identityDescriptor((await headers()).get("cookie"));
  } catch {
    redirect("/auth");
  }
  if (descriptor.stage !== "authenticated") redirect("/auth");
}
export async function requireAuthPage() {
  const { headers } = await import("next/headers.js");
  const incoming = await headers();
  if (incoming.get("x-forma-reset-navigation") === "1") return;
  const { redirect } = await import("next/navigation.js");
  let descriptor;
  try {
    descriptor = await identityDescriptor(incoming.get("cookie"));
  } catch {
    return;
  }
  if (descriptor.stage === "authenticated") redirect("/");
}
async function boundedBody(request) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY))
    return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      reader.releaseLock();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function proxyRecords(
  request,
  resource = "records",
  fetcher = loopbackFetch,
  env = process.env,
) {
  let target;
  try {
    target = transport(env);
  } catch {
    return failure("identity.error.unavailable", 503);
  }
  if (
    !(
      (resource === "records" && ["GET", "POST"].includes(request.method)) ||
      (request.method === "PATCH" &&
        /^records\/[1-9][0-9]{0,18}$/.test(resource)) ||
      (resource === "health" && request.method === "GET")
    )
  )
    return failure("records.error.request", 405);
  try {
    const internal = new URL(request.url);
    const host = request.headers.get("host") || internal.host;
    if (
      internal.protocol !== "http:" ||
      !local.has(internal.hostname) ||
      host !== target.origin.host
    )
      return failure("records.error.origin", 403);
  } catch {
    return failure("records.error.origin", 403);
  }
  const write = request.method !== "GET";
  if (write && request.headers.get("origin") !== target.origin.origin)
    return failure("records.error.origin", 403);
  if (
    write &&
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/json"
  )
    return failure("records.error.request", 415);
  let cookie;
  try {
    cookie = selectedCookies(request.headers.get("cookie"), [target.session]);
  } catch {
    return failure("identity.error.required", 401);
  }
  if (resource !== "health" && !cookie)
    return failure("identity.error.required", 401);
  try {
    const body = write ? await boundedBody(request) : undefined;
    if (body === null) return failure("records.error.request", 413);
    const response = await fetcher(`${target.backend.origin}/api/${resource}`, {
      method: request.method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(write
          ? { "Content-Type": "application/json", Origin: target.origin.origin }
          : {}),
      },
      ...(write ? { body } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    const value = await response.json();
    if (!response.ok)
      return failure(
        codes.has(value.error_code)
          ? value.error_code
          : "records.error.request",
        response.status >= 400 && response.status < 600 ? response.status : 502,
      );
    return Response.json(value, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return failure("records.error.request", 503);
  }
}
