import http from "node:http";
import { loopbackFetch } from "./loopback-fetch.mjs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { settingsFor } from "./settings.mjs";
import { withIdentityStore } from "./store.mjs";

async function components(options) {
  const settings = settingsFor(options);
  if (
    typeof options.sendMail !== "function" ||
    typeof options.onDeliveryFailure !== "function"
  )
    throw new Error(
      "Explicit mail transport and redacted failure observer required",
    );
  const { createPasswordIdentity } = await import(
    pathToFileURL(
      path.join(
        settings.projectRoot,
        "identity/core/lifecycle/src/identity.mjs",
      ),
    )
  );
  const policy = await import(
    pathToFileURL(path.join(settings.projectRoot, "backend-auth/policy.mjs"))
  );
  const { createMockOAuth } = await import(
    pathToFileURL(
      path.join(
        settings.projectRoot,
        "identity/core/lifecycle/src/mock-oauth.mjs",
      ),
    )
  );
  const mockOAuth = createMockOAuth({
    publicOrigin: settings.publicOrigin,
    env: options.env || process.env,
  });
  const identity = createPasswordIdentity({
    ...settings,
    mockOAuth,
    enableTotp: true,
    requireMfa: true,
    permissionPolicy: policy.permissionPolicy,
    onVerifiedUser: policy.onVerifiedUser,
    sendMail: options.sendMail,
    onDeliveryFailure: options.onDeliveryFailure,
  });
  return { settings, identity, policy, mockOAuth };
}
function pythonEnvironment(settings, env, cookieName) {
  return {
    ...env,
    PYTHONPATH: "",
    FORMA_APP_ID: settings.appId,
    FORMA_ORGANIZATION_ID: settings.organizationId,
    DATABASE_PATH: settings.databasePath,
    API_PORT: String(settings.backendPort),
    FORMA_PUBLIC_ORIGIN: settings.publicOrigin,
    PROOF_IDENTITY_URL: `${settings.publicOrigin}/internal/identity`,
    PROOF_SESSION_COOKIE_NAME: cookieName,
  };
}
async function stop(child) {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode)
    return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
  if (child.exitCode === null && !child.signalCode) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}
async function runPython(settings, env, entry) {
  const child = spawn(
    env.PYTHON_BIN || "python3",
    [path.join(settings.projectRoot, "backend-auth", entry)],
    { cwd: settings.projectRoot, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let failed = false;
  child.on("error", () => {
    failed = true;
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  const code = await new Promise((resolve) => {
    child.once("exit", resolve);
    child.once("error", () => resolve(-1));
  });
  if (failed || code !== 0)
    throw new Error(
      "Authenticated domain migration failed; inspect configured stores and source",
    );
}
export async function migrateApplication(options) {
  const { settings, identity, policy } = await components(options);
  try {
    await withIdentityStore(settings, { migrate: true }, async () => {
      await policy.verifyPolicy(identity.pool, { required: false });
      await identity.initialize();
      await policy.migratePolicy(identity.pool);
    });
    await runPython(
      settings,
      pythonEnvironment(settings, options.env || process.env, ""),
      "migrate.py",
    );
  } finally {
    await identity.close();
  }
}
async function freePort(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", () =>
      reject(new Error("Required local service port is already in use")),
    );
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
}
export async function createApplication(options) {
  if (
    (options.env || process.env).FORMA_MOCK_OAUTH === "1" &&
    options.dev !== true
  )
    throw new Error(
      "Local MOCK OAuth requires dev:true; production serving is disabled",
    );
  const { settings, identity, policy, mockOAuth } = await components(options);
  const env = options.env || process.env;
  let nextApp,
    server,
    backend,
    closing = false,
    started = false;
  let closeTask,
    lease = false,
    envSnapshot;
  const configuredKeys = [
    "FORMA_APP_ID",
    "FORMA_PUBLIC_ORIGIN",
    "FORMA_BACKEND_URL",
    "FORMA_SESSION_COOKIE_NAME",
    "FORMA_CHALLENGE_COOKIE_NAME",
  ];
  const close = () => {
    if (closeTask) return closeTask;
    closing = true;
    closeTask = (async () => {
      const tasks = [];
      if (server) {
        server.closeAllConnections();
        tasks.push(new Promise((resolve) => server.close(resolve)));
      }
      if (nextApp) tasks.push(Promise.resolve().then(() => nextApp.close()));
      tasks.push(stop(backend), identity.close());
      await Promise.allSettled(tasks);
      mockOAuth?.close();
      if (lease) {
        for (const key of configuredKeys) {
          if (envSnapshot[key] === undefined) delete process.env[key];
          else process.env[key] = envSnapshot[key];
        }
        delete process.env.FORMA_ACTIVE_APPLICATION_ROOT;
        lease = false;
      }
    })();
    return closeTask;
  };
  async function start() {
    if (started || closing)
      throw new Error("Application already started or closed");
    started = true;
    try {
      if (process.env.FORMA_ACTIVE_APPLICATION_ROOT)
        throw new Error(
          "Only one generated application may run per Node process",
        );
      process.env.FORMA_ACTIVE_APPLICATION_ROOT = settings.projectRoot;
      lease = true;
      envSnapshot = Object.fromEntries(
        configuredKeys.map((key) => [key, process.env[key]]),
      );
      if (closing) throw new Error("Application startup cancelled");
      await freePort(Number(settings.origin.port));
      if (closing) throw new Error("Application startup cancelled");
      await freePort(settings.backendPort);
      if (closing) throw new Error("Application startup cancelled");
      await withIdentityStore(settings, { migrate: false }, () =>
        identity.initialize({ migrate: false }),
      );
      await policy.verifyPolicy(identity.pool);
      const context = await identity.auth.$context,
        cookieName = context.authCookies.sessionToken.name;
      const childEnv = pythonEnvironment(settings, env, cookieName);
      if (closing)
        throw new Error(
          "Application startup cancelled before domain allocation",
        );
      backend = spawn(
        env.PYTHON_BIN || "python3",
        [path.join(settings.projectRoot, "backend-auth/server.py")],
        {
          cwd: settings.projectRoot,
          env: childEnv,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let backendError = false;
      backend.on("error", () => {
        backendError = true;
      });
      let backendReady = false;
      backend.stdout.on("data", (chunk) => {
        if (String(chunk).includes("ready")) backendReady = true;
      });
      backend.stderr.on("data", () => {});
      for (let attempt = 0; ; attempt++) {
        if (closing) throw new Error("Application startup cancelled");
        if (backendError || backend.exitCode !== null)
          throw new Error("Protected domain service failed to start");
        if (backendReady) break;
        if (attempt > 200)
          throw new Error("Protected domain service startup timed out");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const health = await loopbackFetch(`${settings.backendUrl}/api/health`, {
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      });
      const healthData = await health.json();
      if (!health.ok || healthData.authentication !== "password-totp-v1")
        throw new Error("Protected domain readiness mismatch");
      if (closing)
        throw new Error(
          "Application startup cancelled before environment composition",
        );
      Object.assign(process.env, {
        FORMA_APP_ID: settings.appId,
        FORMA_PUBLIC_ORIGIN: settings.publicOrigin,
        FORMA_BACKEND_URL: settings.backendUrl,
        FORMA_SESSION_COOKIE_NAME: cookieName,
        FORMA_CHALLENGE_COOKIE_NAME:
          context.createAuthCookie("two_factor").name,
      });
      const require = createRequire(
        path.join(settings.projectRoot, "frontend/package.json"),
      );
      const resolved = require.resolve("next");
      if (!resolved.startsWith(settings.projectRoot + path.sep))
        throw new Error("Install the child frontend dependencies before start");
      const next = (await import(pathToFileURL(resolved))).default;
      if (closing)
        throw new Error("Application startup cancelled before Next allocation");
      nextApp = next({
        dev: options.dev === true,
        dir: path.join(settings.projectRoot, "frontend"),
        hostname: settings.origin.hostname,
        port: Number(settings.origin.port),
        quiet: true,
      });
      await nextApp.prepare();
      if (closing || backendError || backend.exitCode !== null)
        throw new Error(
          "Application startup cancelled or domain service unavailable",
        );
      const nextHandler = nextApp.getRequestHandler();
      server = http.createServer(async (req, res) => {
        try {
          if (
            !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
              req.socket.remoteAddress,
            ) ||
            req.headers.host !== settings.origin.host
          ) {
            res.writeHead(403);
            res.end();
            return;
          }
          const counts = new Map();
          for (let index = 0; index < req.rawHeaders.length; index += 2) {
            const name = req.rawHeaders[index].toLowerCase();
            counts.set(name, (counts.get(name) || 0) + 1);
          }
          if (
            counts.get("host") !== 1 ||
            ["cookie", "origin", "content-length"].some(
              (name) => (counts.get(name) || 0) > 1,
            )
          ) {
            res.writeHead(400);
            res.end();
            return;
          }
          const cookieNames = [
            cookieName,
            context.createAuthCookie("two_factor").name,
          ];
          if (
            cookieNames.some(
              (name) =>
                (req.headers.cookie || "")
                  .split(";")
                  .filter((part) => part.trim().split("=")[0] === name).length >
                1,
            )
          ) {
            res.writeHead(400);
            res.end();
            return;
          }
          if (mockOAuth && (await mockOAuth.handle(req, res))) return;
          const target = new URL(req.url, settings.publicOrigin);
          if (target.pathname === "/internal/identity") {
            if (req.method !== "GET" || target.search) {
              res.writeHead(404);
              res.end();
              return;
            }
            const result = await identity.introspect(req.headers.cookie || "");
            res.writeHead(result.status, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            });
            res.end(
              JSON.stringify(
                result.principal || {
                  error_code:
                    result.status === 401
                      ? "identity.error.required"
                      : "identity.error.forbidden",
                },
              ),
            );
            return;
          }
          if (target.pathname === "/api/identity") {
            if (req.method !== "GET") {
              res.writeHead(405);
              res.end();
              return;
            }
            req.url = "/api/auth/forma-state";
            return await identity.handler(req, res);
          }
          if (target.pathname.startsWith("/api/auth/"))
            return await identity.handler(req, res);
          for (const name of Object.keys(req.headers))
            if (
              name === "forwarded" ||
              name.startsWith("x-forwarded-") ||
              name.startsWith("x-forma-") ||
              [
                "x-real-ip",
                "cf-connecting-ip",
                "true-client-ip",
                "x-forma-socket-ip",
              ].includes(name)
            )
              delete req.headers[name];
          // Browser retains its transient reset query, while Next never receives/logs token URLs.
          if (target.pathname === "/auth" && target.search) {
            if (target.searchParams.has("token"))
              req.headers["x-forma-reset-navigation"] = "1";
            req.url = "/auth";
          }
          return await nextHandler(req, res);
        } catch {
          if (!res.headersSent)
            res.writeHead(503, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            });
          if (!res.writableEnded)
            res.end(
              JSON.stringify({ error_code: "identity.error.unavailable" }),
            );
        }
      });
      server.requestTimeout = 10000;
      server.headersTimeout = 10000;
      server.keepAliveTimeout = 1000;
      await new Promise((resolve, reject) => {
        server.once("error", () =>
          reject(new Error("Application port unavailable")),
        );
        server.listen(Number(settings.origin.port), "127.0.0.1", resolve);
      });
      if (backendError || backend.exitCode !== null)
        throw new Error("Protected domain service stopped during startup");
      backend.once("exit", () => {
        if (!closing) void close();
      });
      return { url: settings.publicOrigin };
    } catch (error) {
      await close();
      throw error;
    }
  }
  return { start, close, url: settings.publicOrigin };
}
