#!/usr/bin/env node
/*
 * Rasterises the app icons from the SVG sources.
 *
 * Chromium is the only renderer in this project's dev container. Driving it
 * with `--screenshot` gets the size wrong, so this talks to it over the
 * DevTools protocol instead and passes an explicit clip rectangle, which is
 * the only way to guarantee an exact NxN PNG.
 *
 * Usage: node scripts/render-icons.mjs [path-to-chrome]
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
  process.argv[2] ||
  process.env.CHROME_PATH ||
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const TARGETS = [
  { svg: "public/icon.svg", size: 512, out: "public/icon-512.png" },
  { svg: "public/icon.svg", size: 192, out: "public/icon-192.png" },
  { svg: "scripts/icon-maskable.svg", size: 512, out: "public/icon-maskable-512.png" },
  { svg: "scripts/icon-apple.svg", size: 180, out: "public/apple-touch-icon.png" },
];

const PORT = 9333 + (process.pid % 500);

/**
 * The SVG markup goes straight into the page. Referencing it as a file: URL
 * from a data: page is blocked as cross-origin, and inlining also means there
 * is no image decode to wait on.
 */
function wrapperHtml(svgMarkup, size) {
  const sized = svgMarkup
    .replace(/\swidth="\d+"/, ` width="${size}"`)
    .replace(/\sheight="\d+"/, ` height="${size}"`);
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
svg{display:block}</style>
${sized}`;
}

async function waitForDevTools(deadlineMs = 15000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      // Not up yet.
    }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error("Chromium did not expose its DevTools port in time.");
}

/** Minimal CDP client: send a command, wait for the matching id. */
function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;

  const ready = new Promise((ok, fail) => {
    socket.addEventListener("open", () => ok(), { once: true });
    socket.addEventListener("error", () => fail(new Error("CDP socket failed")), { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });

  return {
    ready,
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((resolve_, reject) => {
        pending.set(id, { resolve: resolve_, reject });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close: () => socket.close(),
  };
}

async function main() {
  const profile = await mkdtemp(join(tmpdir(), "icon-render-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const browserUrl = await waitForDevTools();
    const browser = connect(browserUrl);
    await browser.ready;

    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });

    for (const target of TARGETS) {
      const size = target.size;
      const svgMarkup = await readFile(join(ROOT, target.svg), "utf8");
      const html = wrapperHtml(svgMarkup, size);

      await browser.send(
        "Emulation.setDeviceMetricsOverride",
        { width: size, height: size, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
      await browser.send(
        "Page.navigate",
        { url: `data:text/html;base64,${Buffer.from(html).toString("base64")}` },
        sessionId,
      );
      // Inline SVG has nothing left to fetch, so this only covers layout.
      await new Promise((done) => setTimeout(done, 250));

      const { data } = await browser.send(
        "Page.captureScreenshot",
        {
          format: "png",
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
        },
        sessionId,
      );

      await writeFile(join(ROOT, target.out), Buffer.from(data, "base64"));
      console.log(`  ${target.out}  ${size}x${size}`);
    }

    browser.close();
  } finally {
    chrome.kill();
    // Chromium keeps writing its profile for a moment after SIGTERM, so the
    // directory is only safe to remove once the process is actually gone.
    await once(chrome, "exit").catch(() => undefined);
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

await main();
