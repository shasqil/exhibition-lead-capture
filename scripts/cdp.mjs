/**
 * A very small Chrome DevTools Protocol client.
 *
 * Playwright is not available in this project's dev container, and the icon
 * renderer and the smoke test both need to drive Chromium, so they share this
 * instead of taking on a browser-automation dependency.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_CHROME =
  process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

async function waitForDevTools(port, deadlineMs = 20000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error("Chromium did not expose its DevTools port in time.");
}

/** Launches Chromium and returns a connected client plus a page session. */
export async function launch({ chromePath = DEFAULT_CHROME, onConsole } = {}) {
  const port = 9200 + (process.pid % 700);
  const profile = await mkdtemp(join(tmpdir(), "cdp-"));
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--disable-dev-shm-usage",
      // Keep the run hermetic and quiet: no update pings, no first-run UI.
      "--no-first-run",
      "--disable-background-networking",
      "--disable-component-update",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const socketUrl = await waitForDevTools(port);
  const socket = new WebSocket(socketUrl);
  const pending = new Map();
  const waiters = [];
  let nextId = 1;

  await new Promise((ok, fail) => {
    socket.addEventListener("open", () => ok(), { once: true });
    socket.addEventListener("error", () => fail(new Error("CDP socket failed")), { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    for (const waiter of [...waiters]) {
      if (waiter.method === message.method) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message.params);
      }
    }
    if (message.method === "Runtime.consoleAPICalled" && onConsole) {
      onConsole(
        message.params.type,
        message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "),
      );
    }
    if (message.method === "Runtime.exceptionThrown" && onConsole) {
      onConsole("pageerror", message.params.exceptionDetails.text ?? "Uncaught exception");
    }
  });

  let sessionId;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const sendToBrowser = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const { targetId } = await sendToBrowser("Target.createTarget", { url: "about:blank" });
  ({ sessionId } = await sendToBrowser("Target.attachToTarget", { targetId, flatten: true }));

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");

  const page = {
    send,

    /** Resolves when Chromium next reports `method`. */
    waitForEvent(method, timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        const waiter = { method, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index !== -1) {
            waiters.splice(index, 1);
            reject(new Error(`Timed out waiting for ${method}`));
          }
        }, timeoutMs);
      });
    },

    async goto(url) {
      const loaded = page.waitForEvent("Page.loadEventFired");
      await send("Page.navigate", { url });
      await loaded;
    },

    /** Runs an expression in the page and returns its (awaited) value. */
    async evaluate(expression) {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
        );
      }
      return result.result.value;
    },

    /** Polls an expression until it is truthy. */
    async waitFor(expression, { timeoutMs = 15000, label = expression } = {}) {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        try {
          if (await page.evaluate(expression)) return true;
        } catch {
          // The page may still be hydrating.
        }
        await new Promise((done) => setTimeout(done, 200));
      }
      throw new Error(`Timed out waiting for: ${label}`);
    },

    async setViewport(width, height, deviceScaleFactor = 2) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor,
        mobile: true,
      });
    },

    async screenshot(path, { fullPage = false } = {}) {
      const { data } = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: fullPage,
      });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, Buffer.from(data, "base64"));
    },

    /** Puts files into an <input type=file>, the way a photo picker would. */
    async setFiles(selector, files) {
      const { root } = await send("DOM.getDocument", { depth: -1 });
      const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error(`No element matches ${selector}`);
      await send("DOM.setFileInputFiles", { nodeId, files });
    },

    /** Simulates losing signal, which is the whole point of this app. */
    async setOffline(offline) {
      await send("Network.enable");
      await send("Network.emulateNetworkConditions", {
        offline,
        latency: 0,
        downloadThroughput: offline ? 0 : -1,
        uploadThroughput: offline ? 0 : -1,
      });
    },
  };

  return {
    page,
    async close() {
      socket.close();
      chrome.kill();
      await once(chrome, "exit").catch(() => undefined);
      await rm(profile, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
