/** LOCAL MOCK issuer. Maintained genericOAuth owns client state/callback/session checks. */
import http from "node:http";
import messages from "./mock-messages.en-US.json" with { type: "json" };
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
export const MOCK_PROVIDER_IDS = Object.freeze([
  "google",
  "facebook",
  "github",
  "microsoft",
  "apple",
]);
const instances = new WeakSet();
export function assertMockOAuth(value, origin, authBasePath) {
  if (
    !instances.has(value) ||
    value.publicOrigin !== origin ||
    value.authBasePath !== authBasePath
  )
    throw Error("Invalid local mock provider instance");
}
const brands = {
  google: "Google",
  facebook: "Facebook",
  github: "GitHub",
  microsoft: "Microsoft",
  apple: "Apple",
};
const random = () => randomBytes(32).toString("base64url");
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function equal(a, b) {
  const x = Buffer.from(a || ""),
    y = Buffer.from(b || "");
  return x.length === y.length && timingSafeEqual(x, y);
}
function fixedRequest(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: target.port,
        path: target.pathname,
        method: body ? "POST" : "GET",
        agent: false,
        headers: {
          Host: target.host,
          ...headers,
          ...(body
            ? {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
        },
      },
      (response) => {
        let size = 0,
          chunks = [];
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 16384) request.destroy(Error("Mock response too large"));
          else chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            if (response.statusCode !== 200)
              throw Error("Mock exchange denied");
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(Error("Mock exchange denied"));
          }
        });
      },
    );
    request.setTimeout(3000, () =>
      request.destroy(Error("Mock exchange timeout")),
    );
    request.on("error", () => reject(Error("Mock exchange unavailable")));
    if (body) request.write(body);
    request.end();
  });
}
export function createMockOAuth({
  publicOrigin,
  authBasePath = "/api/auth",
  env = process.env,
  now = () => Date.now(),
}) {
  const flag = env.FORMA_MOCK_OAUTH;
  if (flag === undefined || flag === "0") return null;
  const origin = new URL(publicOrigin);
  if (
    flag !== "1" ||
    env.FORMA_ENVIRONMENT !== "local" ||
    env.NODE_ENV === "production" ||
    process.env.NODE_ENV === "production" ||
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(origin.hostname) ||
    !origin.port ||
    origin.origin !== publicOrigin ||
    !/^\/(?:[a-z0-9-]+\/)?api\/auth$/.test(authBasePath)
  )
    throw Error(
      "Mock OAuth requires explicit local nonproduction loopback configuration",
    );
  const base = authBasePath.slice(0, -"/api/auth".length),
    prefix = base + "/__mock-oauth",
    pending = new Map(),
    codes = new Map(),
    tokens = new Map();
  const secrets = new Map(MOCK_PROVIDER_IDS.map((id) => [id, random()]));
  const message = (key, id) =>
    escape(messages[key].replaceAll("{provider}", brands[id]));
  const endpoint = (id, name) => `${publicOrigin}${prefix}/${id}/${name}`;
  const callback = (id) => `${publicOrigin}${authBasePath}/callback/${id}`;
  const client = (id) => `forma-local-mock-${id}`;
  const purge = () => {
    for (const map of [pending, codes, tokens])
      for (const [key, item] of map) if (item.expires <= now()) map.delete(key);
  };
  const configs = MOCK_PROVIDER_IDS.map((id) => ({
    providerId: id,
    clientId: client(id),
    clientSecret: secrets.get(id),
    authorizationUrl: endpoint(id, "authorize"),
    tokenUrl: endpoint(id, "token"),
    userInfoUrl: endpoint(id, "userinfo"),
    scopes: ["profile", "email"],
    pkce: true,
    getToken: async (data) => {
      const value = await fixedRequest(
        endpoint(id, "token"),
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client(id),
          client_secret: secrets.get(id),
          code: data.code,
          redirect_uri: data.redirectURI,
          code_verifier: data.codeVerifier,
        }).toString(),
      );
      return {
        accessToken: value.access_token,
        tokenType: "Bearer",
        accessTokenExpiresAt: new Date(now() + 300000),
      };
    },
    getUserInfo: async (tokens) =>
      fixedRequest(endpoint(id, "userinfo"), null, {
        Authorization: `Bearer ${tokens.accessToken}`,
      }),
  }));
  async function body(req) {
    const length = Number(req.headers["content-length"]);
    if (!Number.isInteger(length) || length < 1 || length > 8192)
      throw Error("Invalid mock request");
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 8192) throw Error("Invalid mock request");
    }
    return new URLSearchParams(raw);
  }
  function json(res, value, status = 200) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  }
  const result = {
    publicOrigin,
    authBasePath,
    configs: Object.freeze(
      configs.map((item) =>
        Object.freeze({ ...item, scopes: Object.freeze(item.scopes) }),
      ),
    ),
    descriptors: Object.freeze(
      MOCK_PROVIDER_IDS.map((id) => Object.freeze({ id, mode: "mock" })),
    ),
    prefix,
    async handle(req, res) {
      const target = new URL(req.url, publicOrigin);
      if (!target.pathname.startsWith(prefix + "/")) return false;
      purge();
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "same-origin");
      res.setHeader("X-Content-Type-Options", "nosniff");
      try {
        if (
          req.headers.host !== origin.host ||
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
            req.socket.remoteAddress,
          )
        )
          throw Error("Invalid mock peer");
        for (const name of ["host", "origin", "cookie", "content-length"])
          if (
            req.rawHeaders.filter(
              (v, i) => i % 2 === 0 && v.toLowerCase() === name,
            ).length > 1
          )
            throw Error("Ambiguous mock request");
        const parts = target.pathname.slice(prefix.length + 1).split("/"),
          [id, operation] = parts;
        if (parts.length !== 2 || !MOCK_PROVIDER_IDS.includes(id))
          throw Error("Unknown mock route");
        if (operation === "authorize" && req.method === "GET") {
          const query = target.searchParams;
          if (
            query.get("client_id") !== client(id) ||
            query.get("redirect_uri") !== callback(id) ||
            query.get("response_type") !== "code" ||
            query.get("code_challenge_method") !== "S256" ||
            !/^[A-Za-z0-9_-]{43}$/.test(query.get("code_challenge") || "") ||
            !query.get("state") ||
            query.get("state").length > 4096
          )
            throw Error("Invalid mock authorization");
          if (pending.size >= 256) throw Error("Mock capacity");
          const requestId = random();
          pending.set(requestId, {
            id,
            state: query.get("state"),
            challenge: query.get("code_challenge"),
            redirect: callback(id),
            expires: now() + 120000,
          });
          res.setHeader(
            "Content-Security-Policy",
            "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
          );
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<!doctype html><html lang="en"><title>${message("title", id)}</title><main><h1>${message("title", id)}</h1><p>${message("notice", id)}</p><form method="post" action="${prefix}/${id}/authorize"><input type="hidden" name="request_id" value="${escape(requestId)}"><label>${message("account", id)}<select name="profile" aria-label="${message("account", id)}"><option value="primary">${message("primary", id)}</option><option value="alternate">${message("alternate", id)}</option><option value="collision">${message("collision", id)}</option></select></label><button name="decision" value="approve">${message("approve", id)}</button><button name="decision" value="cancel">${message("cancel", id)}</button></form></main></html>`,
          );
          return true;
        }
        if (operation === "authorize" && req.method === "POST") {
          if (
            req.headers.origin !== publicOrigin ||
            req.headers["content-type"]?.split(";")[0] !==
              "application/x-www-form-urlencoded"
          )
            throw Error("Mock origin required");
          const data = await body(req),
            key = data.get("request_id"),
            request = pending.get(key);
          pending.delete(key);
          if (!request || request.id !== id || request.expires <= now())
            throw Error("Expired mock consent");
          const redirect = new URL(request.redirect);
          redirect.searchParams.set("state", request.state);
          if (data.get("decision") === "cancel")
            redirect.searchParams.set("error", "access_denied");
          else {
            const profile = data.get("profile");
            if (
              data.get("decision") !== "approve" ||
              !["primary", "alternate", "collision"].includes(profile)
            )
              throw Error("Invalid synthetic profile");
            const code = random();
            codes.set(code, { ...request, profile, expires: now() + 60000 });
            redirect.searchParams.set("code", code);
          }
          res.writeHead(303, { Location: redirect.href });
          res.end();
          return true;
        }
        if (operation === "token" && req.method === "POST") {
          const data = await body(req),
            key = data.get("code"),
            record = codes.get(key);
          codes.delete(key);
          if (
            !record ||
            record.id !== id ||
            record.expires <= now() ||
            data.get("grant_type") !== "authorization_code" ||
            data.get("client_id") !== client(id) ||
            !equal(data.get("client_secret"), secrets.get(id)) ||
            data.get("redirect_uri") !== record.redirect ||
            !/^[A-Za-z0-9._~-]{43,128}$/.test(
              data.get("code_verifier") || "",
            ) ||
            !equal(
              createHash("sha256")
                .update(data.get("code_verifier"))
                .digest("base64url"),
              record.challenge,
            )
          )
            throw Error("Invalid mock exchange");
          const access = random();
          tokens.set(access, {
            id,
            profile: record.profile,
            expires: now() + 300000,
          });
          json(res, {
            access_token: access,
            token_type: "Bearer",
            expires_in: 300,
          });
          return true;
        }
        if (operation === "userinfo" && req.method === "GET") {
          const item = tokens.get(
            (req.headers.authorization || "").replace(/^Bearer /, ""),
          );
          if (!item || item.id !== id || item.expires <= now())
            throw Error("Invalid mock access token");
          json(res, {
            id: `mock-${id}-${item.profile}`,
            name: `Synthetic ${brands[id]} ${item.profile}`,
            email:
              item.profile === "collision"
                ? "collision@synthetic.test"
                : `${id}.${item.profile}@synthetic.test`,
            emailVerified: true,
          });
          return true;
        }
        throw Error("Invalid mock method");
      } catch {
        json(res, { error: "mock_oauth_denied" }, 400);
        return true;
      }
    },
    close() {
      pending.clear();
      codes.clear();
      tokens.clear();
    },
  };
  instances.add(result);
  return Object.freeze(result);
}
