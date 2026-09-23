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
import { join, resolve } from "node:path";
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

    // Every lead must say which show it came from, so an overview spanning
    // several exhibitions is readable without opening anything.
    const labelled = await page.evaluate(`
      [...document.querySelectorAll('main li')].map((item) => {
        const name = item.querySelector('.truncate')?.textContent ?? '?';
        const tag = [...item.querySelectorAll('span')]
          .map((s) => s.textContent.trim())
          .find((t) => t === 'No exhibition' || /20\\d\\d/.test(t));
        return { name, tag: tag ?? null };
      })`);
    const unlabelled = labelled.filter((row) => !row.tag);
    if (labelled.length === 0) throw new Error("No lead cards rendered");
    if (unlabelled.length > 0) {
      throw new Error(`Leads with no exhibition label: ${JSON.stringify(unlabelled)}`);
    }
    step("Every lead shows its exhibition", `${labelled.length} card(s) labelled`);

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

    /* --- Saving must leave a blank form behind ----------------------------- */
    // The autosave once wrote the just-saved lead back as a draft while the
    // form unmounted, so the next capture opened pre-filled with the previous
    // person — and a scan then reported "nothing new" because every field was
    // already taken.
    await page.evaluate(clickByText("nav button", "Capture"));
    await page.waitFor(bodyIncludes("How good is this lead"), { label: "capture screen" });

    const afterSave = await page.evaluate(`
      (() => {
        const value = (label) => {
          const node = [...document.querySelectorAll('label')]
            .find((l) => l.textContent.trim().toLowerCase().startsWith(label));
          return node?.querySelector('input, textarea')?.value ?? '';
        };
        return {
          name: value('name'),
          company: value('company'),
          email: value('email'),
          notes: value('what we talked about'),
        };
      })()`);
    const carried = Object.entries(afterSave).filter(([, value]) => value !== "");
    if (carried.length > 0) {
      throw new Error(`Saved lead carried into the next form: ${JSON.stringify(afterSave)}`);
    }
    step("Form is blank after saving", "nothing carried over from the last lead");

    /* --- Clear empties a form that has been typed into --------------------- */
    await page.evaluate(fillField("Name", "Typed By Mistake"));
    await new Promise((done) => setTimeout(done, 600));
    // Clear asks before discarding, so auto-accept the confirm.
    await page.evaluate(`window.confirm = () => true`);
    if (!(await page.evaluate(clickByText("button", "Clear")))) {
      throw new Error("No Clear button on the capture form");
    }
    await new Promise((done) => setTimeout(done, 600));
    const cleared = await page.evaluate(`
      [...document.querySelectorAll('label')]
        .find((l) => l.textContent.trim().toLowerCase().startsWith('name'))
        ?.querySelector('input')?.value ?? ''`);
    if (cleared !== "") throw new Error(`Clear left "${cleared}" in the name field`);

    // And it must not come back on the next visit to the form.
    await page.evaluate(clickByText("nav button", "Leads"));
    await new Promise((done) => setTimeout(done, 400));
    await page.evaluate(clickByText("nav button", "Capture"));
    await new Promise((done) => setTimeout(done, 800));
    const stillCleared = await page.evaluate(`
      [...document.querySelectorAll('label')]
        .find((l) => l.textContent.trim().toLowerCase().startsWith('name'))
        ?.querySelector('input')?.value ?? ''`);
    if (stillCleared !== "") throw new Error(`Cleared form came back with "${stillCleared}"`);
    step("Clear empties the form", "and it stays empty after leaving and returning");

    /* --- A photo taken earlier can be uploaded ----------------------------- */
    // The camera input carries `capture`, which hides the photo library on a
    // phone. The upload input must not, or there is no way to use a card
    // photographed before the app was opened.
    const inputs = await page.evaluate(`
      Object.fromEntries([...document.querySelectorAll('input[type=file][data-photo]')]
        .map((i) => [i.dataset.photo, i.hasAttribute('capture')]))`);
    if (inputs["front-upload"] !== false || inputs["back-upload"] !== false) {
      throw new Error(`Upload inputs missing or forced to camera: ${JSON.stringify(inputs)}`);
    }
    if (inputs["front-camera"] !== true) {
      throw new Error(`Camera input lost its capture attribute: ${JSON.stringify(inputs)}`);
    }

    await page.setFiles('input[data-photo="front-upload"]', [
      resolve("public/icon-512.png"),
    ]);
    await page.waitFor(
      `[...document.querySelectorAll('img')].some((img) => img.alt.includes('Front') && img.src.startsWith('blob:'))`,
      { label: "the uploaded photo on the form" },
    );
    step("Upload a saved photo", "library input offered, picked photo lands in the Front slot");

    // Leave the form clean for the checks that follow.
    await page.evaluate(`window.confirm = () => true`);
    await page.evaluate(clickByText("button", "Clear"));
    await new Promise((done) => setTimeout(done, 500));

    /* --- The capture time is when the photo was taken ---------------------- */
    // The fixture is a real JPEG whose EXIF says 20 Sep 2026, 10:42:07 +08:00.
    // Uploading it should stamp the lead with that moment, not with now.
    await page.setFiles('input[data-photo="front-upload"]', [
      resolve("scripts/fixtures/card-photo-with-date.jpg"),
    ]);
    await page.waitFor(bodyIncludes("Time taken from the photo"), {
      label: "the photo-time notice",
    });
    // The time notice appears before the card is sent off to be read, so
    // "Save is enabled" can be true in the gap before reading starts. Wait for
    // the read to report back instead — against the stub key it fails, which
    // is fine; what matters is that it has finished.
    await page.waitFor(
      `${bodyIncludes("Could not read")} || ${bodyIncludes("Filled in")} || ${bodyIncludes("already filled in")} || ${bodyIncludes("Couldn't read")}`,
      { label: "the card read to finish" },
    );
    // Names are unique per run: the stub server keeps leads between runs and a
    // fresh browser pulls them all down, so a fixed name can match a stale lead.
    const photoLead = `Photo Time ${Date.now()}`;
    await page.evaluate(fillField("Name", photoLead));
    await page.evaluate(clickByText("button", "Save lead"));
    await page.waitFor(bodyIncludes("Lead saved"), { label: "photo-time lead saved" });

    const storedTime = (name) => `
      new Promise((resolve) => {
        const open = indexedDB.open('exhibition-lead-capture');
        open.onsuccess = () => {
          const all = open.result.transaction('leads', 'readonly').objectStore('leads').getAll();
          all.onsuccess = () =>
            resolve(all.result.find((l) => l.full_name === ${JSON.stringify(name)})?.captured_at ?? null);
        };
      })`;
    const fromPhoto = await page.evaluate(storedTime(photoLead));
    if (fromPhoto !== "2026-09-20T02:42:07.000Z") {
      throw new Error(`Lead time should come from the photo's EXIF, got ${fromPhoto}`);
    }
    step("Capture time read from the photo", "EXIF 10:42 +08:00 stored as 02:42 UTC");

    /* --- Without a photo, the clock starts at the first thing typed -------- */
    // The capture form exists from the moment the screen opens, which can be
    // long before anyone walks up. Wait, then type, then check the stamp is
    // the typing, not the opening.
    await new Promise((done) => setTimeout(done, 2500));
    const beforeTyping = await page.evaluate(`new Date().toISOString()`);
    const typedLead = `Typed Later ${Date.now()}`;
    await page.evaluate(fillField("Name", typedLead));
    await page.evaluate(clickByText("button", "Save lead"));
    await page.waitFor(bodyIncludes("Lead saved"), { label: "typed lead saved" });
    const typedTime = await page.evaluate(storedTime(typedLead));
    if (!typedTime || typedTime < beforeTyping) {
      throw new Error(`Lead stamped ${typedTime}, before typing began at ${beforeTyping}`);
    }
    step("No photo: time starts at first input", "not when the screen opened");

    /* --- A half-typed lead survives tapping away --------------------------- */
    // The capture form is filled in mid-conversation. Leaving it, by tab or by
    // the browser discarding the page, must never cost the conversation.
    await page.evaluate(clickByText("nav button", "Capture"));
    await page.waitFor(bodyIncludes("How good is this lead"), { label: "capture screen" });

    await page.evaluate(fillField("Name", "Wei Ming Lim"));
    await page.evaluate(fillField("Company", "Sembcorp Marine"));
    await page.evaluate(
      fillField("What we talked about", "Half-typed when the phone rang."),
    );
    await page.evaluate(clickByText("button", "Armourflex"));
    // Longer than the autosave debounce.
    await new Promise((done) => setTimeout(done, 900));

    await page.evaluate(clickByText("nav button", "Leads"));
    await page.waitFor(bodyIncludes("Jane Tan"), { label: "leads list" });
    await page.evaluate(clickByText("nav button", "Capture"));
    await page.waitFor(bodyIncludes("Picked up where you left off"), {
      label: "the restored draft",
    });

    const restored = await page.evaluate(`
      (() => {
        const value = (label) => {
          const node = [...document.querySelectorAll('label')]
            .find((l) => l.textContent.trim().toLowerCase().startsWith(label));
          return node?.querySelector('input, textarea')?.value ?? '';
        };
        const chip = [...document.querySelectorAll('button')]
          .find((b) => b.textContent.includes('Armourflex'));
        return {
          name: value('name'),
          company: value('company'),
          notes: value('what we talked about'),
          product: chip?.getAttribute('aria-pressed'),
        };
      })()`);

    if (restored.name !== "Wei Ming Lim" || restored.company !== "Sembcorp Marine") {
      throw new Error(`Draft lost the contact fields: ${JSON.stringify(restored)}`);
    }
    if (!restored.notes.includes("Half-typed")) {
      throw new Error(`Draft lost the notes: ${JSON.stringify(restored)}`);
    }
    if (restored.product !== "true") {
      throw new Error(`Draft lost the product selection: ${JSON.stringify(restored)}`);
    }
    step("Unsaved lead survived leaving the form", "fields and product still there");

    /* --- And survives the page being closed entirely ----------------------- */
    await page.goto(BASE);
    await page.waitFor(bodyIncludes("Picked up where you left off"), {
      label: "the draft after a full reload",
    });
    const afterReload = await page.evaluate(`
      [...document.querySelectorAll('label')]
        .find((l) => l.textContent.trim().toLowerCase().startsWith('name'))
        ?.querySelector('input')?.value ?? ''`);
    if (afterReload !== "Wei Ming Lim") {
      throw new Error(`Draft did not survive a reload, got "${afterReload}"`);
    }
    step("Unsaved lead survived a full reload");
    await page.screenshot(join(SHOTS, "7-draft.png"));

    /* --- The save button must actually be reachable ------------------------ */
    // It was previously fixed to the viewport bottom, underneath the tab bar.
    const saveVisible = await page.evaluate(`
      (() => {
        const button = [...document.querySelectorAll('button')]
          .find((b) => b.textContent.trim() === 'Save lead');
        if (!button) return { found: false };
        const r = button.getBoundingClientRect();
        // What is actually painted at the button's centre?
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { found: true, covered: !button.contains(hit) && hit !== button };
      })()`);
    if (!saveVisible.found) throw new Error("No Save lead button on the capture form");
    if (saveVisible.covered) throw new Error("Save lead button is covered by something else");
    step("Save button is reachable", "nothing painted on top of it");

    /* --- The exhibition is chosen where the lead is captured --------------- */
    const picker = await page.evaluate(`
      (() => {
        const label = [...document.querySelectorAll('label')]
          .find((l) => l.textContent.toLowerCase().includes('capturing for'));
        if (!label) return { found: false };
        const select = label.querySelector('select');
        return { found: Boolean(select), options: [...(select?.options ?? [])].map((o) => o.text) };
      })()`);
    if (!picker.found) throw new Error("No exhibition picker on the capture screen");
    if (!picker.options?.some((text) => text.includes("Add an exhibition"))) {
      throw new Error(`Picker cannot reach event creation: ${JSON.stringify(picker.options)}`);
    }
    step("Exhibition is set on the capture screen", "with a route to adding one");

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
