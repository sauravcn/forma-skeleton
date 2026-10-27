/** Fixed local service transport: never uses environment proxy dispatchers. */
import http from "node:http";
export function loopbackFetch(value, options = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid local service target");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.port ||
    Number(url.port) < 1 ||
    Number(url.port) > 65535 ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("Explicit loopback service target required");
  if (options.signal?.aborted)
    return Promise.reject(new Error("Local service request aborted"));
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(options.headers));
    delete headers.host;
    delete headers["transfer-encoding"];
    headers.Host = url.host;
    const body =
      options.body === undefined ? undefined : Buffer.from(options.body);
    if (body) headers["Content-Length"] = String(body.length);
    else delete headers["content-length"];
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    const fail = () => {
      cleanup();
      reject(new Error("Local service unavailable"));
    };
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: Number(url.port),
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers,
        agent: false,
      },
      (response) => {
        const chunks = [];
        let length = 0;
        response.on("error", fail);
        response.on("data", (chunk) => {
          length += chunk.length;
          if (length > 8 * 1024 * 1024) {
            request.destroy();
            fail();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          cleanup();
          try {
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(response.headers))
              for (const item of Array.isArray(value) ? value : [value])
                if (item !== undefined) responseHeaders.append(name, item);
            resolve(
              new Response(
                [204, 205, 304].includes(response.statusCode)
                  ? null
                  : Buffer.concat(chunks),
                {
                  status: response.statusCode,
                  headers: responseHeaders,
                },
              ),
            );
          } catch {
            fail();
          }
        });
      },
    );
    const abort = () => request.destroy();
    request.on("error", fail);
    options.signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => request.destroy(), 5000);
    request.end(body);
  });
}
