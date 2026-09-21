"use client";

import {
  countPending,
  getLastPulledAt,
  markSyncError,
  markSynced,
  mergeServerLeads,
  pendingLeads,
  putLeadRaw,
  setLastPulledAt,
  subscribeToLeads,
} from "./local-db";
import { blobToBase64 } from "./image";
import { CARD_FIELDS, toWireLead, type CardExtraction, type LocalLead } from "./types";

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  pending: number;
  lastSyncedAt: string | null;
  error: string | null;
}

let status: SyncStatus = {
  online: true,
  syncing: false,
  pending: 0,
  lastSyncedAt: null,
  error: null,
};

const statusListeners = new Set<() => void>();

export function subscribeToSync(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const listener of statusListeners) listener();
}

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

async function refreshPendingCount() {
  try {
    setStatus({ pending: await countPending() });
  } catch {
    // A failed count is not worth surfacing; the next change will retry.
  }
}

/* -------------------------------------------------------------------------- */
/* Pushing one lead                                                            */
/* -------------------------------------------------------------------------- */

async function uploadPhoto(leadId: string, side: "front" | "back", blob: Blob): Promise<string> {
  const form = new FormData();
  form.append("file", blob, `${leadId}-${side}.jpg`);
  form.append("lead_id", leadId);
  form.append("side", side);
  const response = await fetch("/api/upload", { method: "POST", body: form });
  if (!response.ok) throw new Error(await readError(response, "Photo upload failed"));
  const { url } = (await response.json()) as { url: string };
  return url;
}

/**
 * Reads a card that was photographed with no signal.
 *
 * Only blank fields are filled, so anything typed at the booth by hand always
 * beats what the scan comes back with later.
 */
async function scanDeferred(lead: LocalLead): Promise<Partial<LocalLead>> {
  const images: { base64: string; media_type: string }[] = [];
  for (const blob of [lead.pending_front, lead.pending_back]) {
    if (blob) {
      images.push({ base64: await blobToBase64(blob), media_type: blob.type || "image/jpeg" });
    }
  }
  if (images.length === 0) return {};

  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images, event_name: lead.event_name }),
  });
  if (!response.ok) throw new Error(await readError(response, "Card reading failed"));

  const { fields } = (await response.json()) as { fields: CardExtraction };
  const patch: Partial<LocalLead> = {};
  for (const field of CARD_FIELDS) {
    const value = fields[field];
    if (value && !lead[field].trim()) patch[field] = value;
  }
  return patch;
}

async function pushLead(lead: LocalLead): Promise<void> {
  const syncedUpdatedAt = lead.updated_at;
  let working: LocalLead = lead;

  if (working.needs_scan && !working.deleted) {
    let scanned: Partial<LocalLead> = {};
    try {
      scanned = await scanDeferred(working);
    } catch {
      // Reading the card is a convenience. If it fails, the lead itself still
      // has to reach the server — blocking the push on it would strand a real
      // conversation over a bad photo, and the photos upload either way so the
      // details can be read off them by hand.
    }
    // The attempt is spent either way. Leaving the flag on would mean a server
    // that stays down turns the retry loop into a stream of billed scan calls.
    // updated_at is untouched, so the lead stays queued for the push below.
    working = { ...working, ...scanned, needs_scan: false };
    await putLeadRaw(working);
  }

  const patch: Partial<LocalLead> = {};
  if (working.pending_front && !working.card_front_url) {
    patch.card_front_url = await uploadPhoto(working.id, "front", working.pending_front);
  }
  if (working.pending_back && !working.card_back_url) {
    patch.card_back_url = await uploadPhoto(working.id, "back", working.pending_back);
  }
  working = { ...working, ...patch };

  const response = await fetch("/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leads: [toWireLead(working)] }),
  });
  if (!response.ok) throw new Error(await readError(response, "Could not save to the server"));

  await markSynced(working.id, syncedUpdatedAt, patch);
}

/* -------------------------------------------------------------------------- */
/* The sync pass                                                               */
/* -------------------------------------------------------------------------- */

let running = false;
let rerun = false;

export async function syncNow(): Promise<void> {
  if (!isOnline()) {
    setStatus({ online: false });
    await refreshPendingCount();
    return;
  }
  // Coalesce overlapping triggers into one more pass after the current one.
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  setStatus({ syncing: true, error: null });

  try {
    const queue = await pendingLeads();
    let firstError: string | null = null;

    for (const lead of queue) {
      try {
        await pushLead(lead);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sync failed";
        await markSyncError(lead.id, message);
        firstError ??= message;
      }
    }

    await pull();
    setStatus({
      lastSyncedAt: new Date().toISOString(),
      error: firstError,
      // Finishing a pass proves we *were* online, not that we still are — the
      // signal can drop while the last request is in flight, and a badge that
      // then reads "All synced" is exactly the lie this app must not tell.
      online: isOnline(),
    });
  } catch (error) {
    setStatus({
      error: error instanceof Error ? error.message : "Sync failed",
      online: isOnline(),
    });
  } finally {
    running = false;
    setStatus({ syncing: false });
    await refreshPendingCount();
    if (rerun) {
      rerun = false;
      void syncNow();
    }
  }
}

/** Brings down everything the rest of the team has captured. */
async function pull(): Promise<void> {
  const since = await getLastPulledAt();
  const url = since ? `/api/leads?since=${encodeURIComponent(since)}` : "/api/leads";
  const response = await fetch(url);
  if (!response.ok) throw new Error(await readError(response, "Could not load team leads"));

  const { leads, now } = (await response.json()) as { leads: LocalLead[]; now: string };
  if (leads.length > 0) await mergeServerLeads(leads);
  await setLastPulledAt(now);
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return `${fallback} (${response.status})`;
  }
}

/* -------------------------------------------------------------------------- */
/* Wiring                                                                      */
/* -------------------------------------------------------------------------- */

let started = false;

/** Called once from the app shell. Safe to call again. */
export function startSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  setStatus({ online: navigator.onLine });

  window.addEventListener("online", () => {
    setStatus({ online: true });
    void syncNow();
  });
  window.addEventListener("offline", () => setStatus({ online: false }));

  // Any local write is a reason to try again.
  subscribeToLeads(() => void refreshPendingCount());

  // A booth phone sits in a pocket between conversations; catching it on wake
  // matters more than a tight interval.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  setInterval(() => void syncNow(), 60_000);

  void syncNow();
}
