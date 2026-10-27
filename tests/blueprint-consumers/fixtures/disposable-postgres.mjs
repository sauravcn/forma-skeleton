/** A new synthetic store per consumer proof. Never inspects existing containers. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
const execute = promisify(execFile);
const docker = (args) =>
  execute("docker", args, { timeout: 20000, maxBuffer: 65536 });
export async function disposablePostgres() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "forma-auth-consumer-pg-"),
  );
  const name = `forma-auth-consumer-${randomBytes(8).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  const file = path.join(directory, "postgres.env");
  let created = false;
  const close = async () => {
    try {
      if (created)
        await docker(["rm", "-f", name]).catch((error) => {
          if (!/No such container/.test(error.stderr || ""))
            throw new Error(
              "Unable to remove owned synthetic PostgreSQL fixture",
            );
        });
    } finally {
      created = false;
      await fs.rm(directory, { recursive: true, force: true });
    }
  };
  try {
    await fs.writeFile(
      file,
      `POSTGRES_USER=consumer\nPOSTGRES_DB=consumer\nPOSTGRES_PASSWORD=${password}\n`,
      { mode: 0o600 },
    );
    created = true; // Docker can start the container even if its CLI later times out.
    await docker([
      "run",
      "--detach",
      "--rm",
      "--name",
      name,
      "--env-file",
      file,
      "--tmpfs",
      "/var/lib/postgresql/data:rw,nosuid,size=256m",
      "--publish",
      "127.0.0.1::5432",
      "--pull",
      "never",
      "postgres:17-bookworm",
    ]);
    const { stdout } = await docker(["port", name, "5432/tcp"]);
    const port = Number(stdout.trim().split(":").at(-1));
    if (!Number.isInteger(port) || port < 1)
      throw new Error("Invalid synthetic PostgreSQL binding");
    const databaseUrl = `postgres://consumer:${password}@127.0.0.1:${port}/consumer`;
    const deadline = Date.now() + 20000;
    for (;;) {
      const probe = new pg.Client({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 1000,
      });
      probe.on("error", () => {});
      try {
        await probe.connect();
        await probe.query("SELECT 1");
        break;
      } catch {
        if (Date.now() >= deadline)
          throw new Error("Synthetic PostgreSQL readiness timeout");
      } finally {
        await probe.end().catch(() => {});
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    // Remove the transient file as soon as Docker has consumed it.
    await fs.rm(file);
    return { databaseUrl, close };
  } catch {
    await close();
    throw new Error(
      "Unable to initialize isolated synthetic PostgreSQL consumer fixture",
    );
  }
}
