import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { execFile as rawExecFile } from "node:child_process";
import { promisify } from "node:util";
const execFile = promisify(rawExecFile);
test("native local transport never sends credentials through hostile environment proxy", async (t) => {
  let proxyCalls = 0,
    targetCalls = 0;
  const target = http.createServer((request, response) => {
    targetCalls++;
    assert.ok(request.headers.cookie === "synthetic_session=private");
    if (request.url === "/no-content") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.url === "/invalid-status") {
      response.writeHead(999);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"ok":true}');
  });
  const proxy = http.createServer((request, response) => {
    proxyCalls++;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"proxied":true}');
  });
  const tunnelSockets = new Set();
  proxy.on("connect", (request, socket, head) => {
    proxyCalls++;
    tunnelSockets.add(socket);
    const upstream = net.connect(
      { host: "127.0.0.1", port: target.address().port },
      () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      },
    );
    tunnelSockets.add(upstream);
    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
  });
  await Promise.all([
    new Promise((resolve) => target.listen(0, "127.0.0.1", resolve)),
    new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve)),
  ]);
  t.after(async () => {
    for (const socket of tunnelSockets) socket.destroy();
    target.closeAllConnections();
    proxy.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => target.close(resolve)),
      new Promise((resolve) => proxy.close(resolve)),
    ]);
  });
  const endpoint = `http://localhost:${target.address().port}/private`,
    environment = {
      ...process.env,
      NODE_USE_ENV_PROXY: "1",
      HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`,
      HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`,
      ALL_PROXY: `http://127.0.0.1:${proxy.address().port}`,
      http_proxy: `http://127.0.0.1:${proxy.address().port}`,
      https_proxy: `http://127.0.0.1:${proxy.address().port}`,
      all_proxy: `http://127.0.0.1:${proxy.address().port}`,
      NO_PROXY: "",
      no_proxy: "",
    };
  const module = new URL("../loopback-fetch.mjs", import.meta.url).href;
  await execFile(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {loopbackFetch} from ${JSON.stringify(module)};const result=await loopbackFetch(${JSON.stringify(endpoint)},{headers:{Cookie:'synthetic_session=private'}});if(!(await result.json()).ok)process.exit(1);`,
    ],
    { env: environment, timeout: 10000, maxBuffer: 8192 },
  );
  assert.equal(targetCalls, 1);
  assert.equal(proxyCalls, 0);
  await execFile(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {loopbackFetch} from ${JSON.stringify(module)};const options={headers:{Cookie:'synthetic_session=private'}};const empty=await loopbackFetch(${JSON.stringify(new URL("/no-content", endpoint).href)},options);if(empty.status!==204||(await empty.text())!=='')process.exit(1);let denied=false;try{await loopbackFetch(${JSON.stringify(new URL("/invalid-status", endpoint).href)},options);}catch{denied=true;}if(!denied)process.exit(1);`,
    ],
    { env: environment, timeout: 10000, maxBuffer: 8192 },
  );
  assert.equal(proxyCalls, 0);
  if (Number(process.versions.node.split(".")[0]) >= 24) {
    await execFile(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const response=await fetch(${JSON.stringify(endpoint)},{headers:{Cookie:'synthetic_session=private',Connection:'close'}});await response.json();`,
      ],
      { env: environment, timeout: 10000, maxBuffer: 8192 },
    );
    assert.equal(proxyCalls, 1);
  }
});
