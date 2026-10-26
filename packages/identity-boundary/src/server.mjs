/** Private loopback introspection adapter, not a test-login or full auth service. */
import http from "node:http";

function send(response, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": bytes.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(bytes);
}

export function identityServer(identity) {
  const server = http.createServer(async (request, response) => {
    try {
      const host = request.headers.host;
      if (!/^(localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/.test(host || ""))
        return send(response, 403, { error_code: "identity.error.origin" });
      if (request.method !== "GET" || request.url !== "/internal/identity")
        return send(response, 404, { error_code: "identity.error.notFound" });
      // No user, role, organization or target URL is read from client headers/query.
      const result = await identity.introspect(request.headers.cookie || "");
      return send(
        response,
        result.status,
        result.principal || {
          error_code:
            result.status === 401
              ? "identity.error.required"
              : "identity.error.forbidden",
        },
      );
    } catch {
      return send(response, 503, { error_code: "identity.error.unavailable" });
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  return server;
}
