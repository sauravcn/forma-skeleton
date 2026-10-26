// Server routes only. Never import this module into a client component.
const MAX_BODY = 16384;
const knownCodes = new Set([
  "records.error.invalid",
  "records.error.notFound",
  "records.error.stale",
  "records.error.origin",
  "records.error.request",
]);
const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
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
function backendBase(env) {
  const url = new URL(env.FORMA_BACKEND_URL || "http://127.0.0.1:8765");
  if (
    url.protocol !== "http:" ||
    !localHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Invalid backend target");
  return url.origin;
}
function servedOrigin(request, target) {
  // Next may normalize Request.url to localhost while the served Host is 127.0.0.1.
  // Use only the exact validated local Host, never X-Forwarded-* from a client.
  const host = request.headers.get("host") ?? target.host;
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?$/i.exec(
    host,
  );
  if (
    !match ||
    (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))
  )
    throw new Error("Invalid served host");
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("Invalid served protocol");
  return new URL(`${target.protocol}//${host}`).origin;
}
async function body(request) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY))
    return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
export async function proxyRecords(
  request,
  resource = "records",
  fetcher = fetch,
  env = process.env,
) {
  const write = request.method !== "GET";
  let target;
  try {
    target = new URL(request.url);
  } catch {
    return failure("records.error.request", 400);
  }
  if (!localHosts.has(target.hostname))
    return failure("records.error.origin", 403);
  let expectedOrigin;
  try {
    expectedOrigin = servedOrigin(request, target);
  } catch {
    return failure("records.error.origin", 403);
  }
  if (
    !(["GET", "POST"].includes(request.method) && resource === "records") &&
    !(request.method === "PATCH" && /^records\/[1-9]\d*$/.test(resource)) &&
    !(request.method === "GET" && resource === "health")
  )
    return failure("records.error.request", 405);
  if (write) {
    const origin = request.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).origin !== expectedOrigin)
          return failure("records.error.origin", 403);
      } catch {
        return failure("records.error.origin", 403);
      }
    }
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      return failure("records.error.request", 415);
  }
  try {
    const payload = write ? await body(request) : undefined;
    if (payload === null) return failure("records.error.request", 413);
    // Origin was validated above. Do not forward cookies, credentials or arbitrary headers.
    const response = await fetcher(`${backendBase(env)}/api/${resource}`, {
      method: request.method,
      headers: write ? { "Content-Type": "application/json" } : {},
      ...(write ? { body: payload } : {}),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    if (!response.ok)
      return failure(
        knownCodes.has(data.error_code)
          ? data.error_code
          : "records.error.request",
        response.status >= 400 && response.status < 600 ? response.status : 502,
      );
    return Response.json(data, {
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
