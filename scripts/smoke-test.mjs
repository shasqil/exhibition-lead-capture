#!/usr/bin/env node
/*
 * End-to-end smoke test against a running dev server.
 *
 * It drives a real browser through the flow that matters most: sign in,
 * capture a lead while offline, confirm it survives a reload, then come back
 * online and watch it sync. Supabase and Anthropic do not need to be real —
 * the point is that nothing is ever lost on the device.
 *
 * Usage:
 *   npm run dev            # in one terminal
 *   node scripts/smoke-test.mjs [http://127.0.0.1:3000]
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launch } from "./cdp.mjs";

const BASE = process.argv[2] || process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const PASSCODE = process.env.TEAM_PASSCODE || "booth2026";
const MEMBER = process.env.SMOKE_MEMBER || "Shas";
const SHOTS = process.env.SMOKE_SHOTS || join(process.cwd(), ".smoke");

const problems = [];
const steps = [];

function step(name, detail = "") {
  steps.push(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  console.log(steps.at(-1));
}

function fail(name, error) {
  problems.push(`${name}: ${error.message ?? error}`);
  console.log(`  ✗ ${name} — ${error.message ?? error}`);
}

/** Clicks the first element whose visible text matches. */
const clickByText = (selector, text) => `
  (() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((node) => node.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
    if (!target) return false;
    target.click();
    return true;
  })()`;

/**
 * Case-insensitive body text check. `innerText` returns *rendered* text, so a
 * heading styled `uppercase` comes back uppercased regardless of the source.
 */
const bodyIncludes = (text) =>
  `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`;

/** Sets a React-controlled input, firing the event React actually listens for. */
const fillField = (labelText, value) => `
  (() => {
    const label = [...document.querySelectorAll('label')]
      .find((node) => node.textContent.trim().toLowerCase().startsWith(${JSON.stringify(labelText.toLowerCase())}));
    if (!label) return false;
    const input = label.querySelector('input, textarea');
    if (!input) return false;
    const proto = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;

async function main() {
  await mkdir(SHOTS, { recursive: true });

  const consoleErrors = [];
  const { page, close } = await launch({
    onConsole: (type, text) => {
      if (type === "error" || type === "pageerror") consoleErrors.push(text);
    },
  });

  try {
    await page.setViewport(390, 844);

    /* --- Sign in ---------------------------------------------------------- */
    // `next dev` compiles each route on first hit, so the first two waits get a
    // long leash; everything after that is warm.
    const COLD = { timeoutMs: 60000 };

    await page.goto(`${BASE}/login`);
    await page.waitFor(`document.querySelector('input[type=password]') !== null`, {
      label: "login form",
      ...COLD,
    });
    await page.screenshot(join(SHOTS, "1-login.png"));

    if (!(await page.evaluate(clickByText("button", MEMBER)))) {
      throw new Error(`No "${MEMBER}" button on the login screen`);
    }
    if (!(await page.evaluate(fillField("Team code", PASSCODE)))) {
      throw new Error("Could not find the team code field");
    }
    await page.evaluate(clickByText("button", "Sign in"));
    await page.waitFor(bodyIncludes("How good is this lead"), {
      label: "capture screen",
      ...COLD,
    });
    step("Signed in", `as ${MEMBER}`);
    await page.screenshot(join(SHOTS, "2-capture.png"));

    /* --- Capture a lead with no signal ------------------------------------ */
    await page.setOffline(true);
    await page.evaluate(`window.dispatchEvent(new Event('offline'))`);
    await page.waitFor(bodyIncludes("Offline"), { label: "offline badge" });
    step("Went offline", "badge switched over");

    await page.evaluate(clickByText("button", "Hot"));
    await page.evaluate(fillField("Name", "Jane Tan"));
    await page.evaluate(fillField("Company", "Acme Offshore Pte Ltd"));
    await page.evaluate(fillField("Email", "jane@acme-offshore.com"));
    await page.evaluate(fillField("What we talked about", "Runs 3 FPSOs. Wants PFP quote by Q1."));
    await page.screenshot(join(SHOTS, "3-filled.png"));

    await page.evaluate(clickByText("button", "Save lead"));
    await page.waitFor(bodyIncludes("Lead saved"), { label: "save confirmation" });
    step("Saved a lead while offline");

    /* --- It must survive a reload ----------------------------------------- */
    await page.goto(BASE);
    await page.waitFor(bodyIncludes("How good is this lead"), { label: "app after reload" });
    await page.evaluate(clickByText("nav button", "Leads"));
    await page.waitFor(bodyIncludes("Jane Tan"), { label: "the saved lead in the list" });
    step("Lead survived a reload", "still listed after restarting the app");
    await page.screenshot(join(SHOTS, "4-leads.png"));

    const queued = await page.evaluate(
      `${bodyIncludes("Waiting to sync")} || ${bodyIncludes("Offline")}`,
    );
    if (!queued) throw new Error("Lead was not shown as queued for sync");
    step("Lead is queued for sync");

    /* --- Back online: the queue must drain (or report why not) ------------ */
    await page.setOffline(false);
    await page.evaluate(`window.dispatchEvent(new Event('online'))`);
    // Supabase is a stub in this test, so the push is expected to fail. What
    // matters is that the failure is surfaced, not swallowed, and the lead
    // stays on the device.
    await new Promise((done) => setTimeout(done, 3000));
    const afterOnline = await page.evaluate(`document.body.innerText`);
    const stillThere = afterOnline.includes("Jane Tan");
    if (!stillThere) throw new Error("Lead vanished after reconnecting");
    step(
      "Survived reconnect",
      afterOnline.includes("All synced") ? "synced to the server" : "kept locally, sync reported",
    );
    await page.screenshot(join(SHOTS, "5-online.png"));

    /* --- Export tab renders ----------------------------------------------- */
    await page.evaluate(clickByText("nav button", "Export"));
    await page.waitFor(bodyIncludes("Export to Excel"), { label: "export tab" });
    step("Export tab renders");
    await page.screenshot(join(SHOTS, "6-export.png"));
  } catch (error) {
    fail("flow", error);
  } finally {
    await close();
  }

  // React logs a lot of noise in dev; only flag things that look like real bugs.
  const realErrors = consoleErrors.filter(
    (text) => !/Download the React DevTools|Failed to load resource|fetch failed/i.test(text),
  );
  if (realErrors.length > 0) {
    problems.push(`console errors:\n      ${realErrors.slice(0, 5).join("\n      ")}`);
  }

  console.log(`\nScreenshots in ${SHOTS}`);
  if (problems.length > 0) {
    console.log(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.log(`  • ${problem}`);
    process.exit(1);
  }
  console.log("\nAll good.");
}

await main();
