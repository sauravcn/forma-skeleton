import net from "node:net";
const exits = new WeakMap();
export function observeClose(child) {
  if (!exits.has(child))
    exits.set(child, new Promise((resolve) => child.once("close", resolve)));
  return exits.get(child);
}
async function within(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function stopOwnedChildren(children, { grace = 3000 } = {}) {
  const results = await Promise.allSettled(
    [...children].map(async (child) => {
      const closed = observeClose(child);
      for (const signal of ["SIGTERM", "SIGKILL"]) {
        if (child.pid)
          try {
            process.kill(-child.pid, signal);
          } catch (error) {
            if (error.code !== "ESRCH")
              throw Error("Owned process cleanup failed");
          }
        if (await within(closed, grace)) return;
      }
      throw Error("Owned process did not close");
    }),
  );
  if (results.some((result) => result.status === "rejected"))
    throw Error("Owned process cleanup failed");
}
export async function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(true));
  });
}
export function safeFailureKind(error) {
  return ["AssertionError", "TimeoutError", "Error", "TypeError"].includes(
    error?.name,
  )
    ? error.name
    : "Error";
}
