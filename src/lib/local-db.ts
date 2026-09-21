"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ExhibitionEvent, LocalLead } from "./types";

const DB_NAME = "exhibition-lead-capture";
const DB_VERSION = 1;

interface LeadDB extends DBSchema {
  leads: {
    key: string;
    value: LocalLead;
    indexes: { by_sync_state: string; by_captured_at: string };
  };
  meta: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<LeadDB>> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB<LeadDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const leads = database.createObjectStore("leads", { keyPath: "id" });
        leads.createIndex("by_sync_state", "sync_state");
        leads.createIndex("by_captured_at", "captured_at");
        database.createObjectStore("meta");
      },
    });
  }
  return dbPromise;
}

/** Notifies open screens that the local store changed, so lists re-render. */
const listeners = new Set<() => void>();

export function subscribeToLeads(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}

/** Saves a lead locally and queues it for the server. Never blocks on network. */
export async function saveLead(lead: LocalLead): Promise<void> {
  const record: LocalLead = {
    ...lead,
    updated_at: new Date().toISOString(),
    sync_state: "pending",
    sync_error: undefined,
  };
  await (await db()).put("leads", record);
  notify();
}

/** Used by the sync engine to write back server state without re-queueing it. */
export async function putLeadRaw(lead: LocalLead): Promise<void> {
  await (await db()).put("leads", lead);
  notify();
}

export async function getLead(id: string): Promise<LocalLead | undefined> {
  return (await db()).get("leads", id);
}

export async function allLeads(): Promise<LocalLead[]> {
  const leads = await (await db()).getAll("leads");
  return leads
    .filter((lead) => !lead.deleted)
    .sort((a, b) => b.captured_at.localeCompare(a.captured_at));
}

export async function pendingLeads(): Promise<LocalLead[]> {
  return (await db()).getAllFromIndex("leads", "by_sync_state", "pending");
}

export async function countPending(): Promise<number> {
  return (await db()).countFromIndex("leads", "by_sync_state", "pending");
}

/** Soft delete: the tombstone still has to reach the server and other phones. */
export async function deleteLead(id: string): Promise<void> {
  const existing = await getLead(id);
  if (!existing) return;
  await saveLead({ ...existing, deleted: true, pending_front: undefined, pending_back: undefined });
}

/**
 * Marks a lead as synced, but only if it has not been edited since the push
 * started — otherwise the edit would be silently dropped from the queue.
 *
 * `patch` carries values the push itself produced (the uploaded photo URLs), so
 * they land without counting as a fresh edit.
 */
export async function markSynced(
  id: string,
  syncedUpdatedAt: string,
  patch: Partial<LocalLead> = {},
): Promise<void> {
  const database = await db();
  const transaction = database.transaction("leads", "readwrite");
  const store = transaction.objectStore("leads");
  const current = await store.get(id);
  if (current) {
    const stillQueued = current.updated_at !== syncedUpdatedAt;
    await store.put({
      ...current,
      ...patch,
      // An edit landed mid-push, so this lead has to go round again.
      sync_state: stillQueued ? "pending" : "synced",
      sync_error: undefined,
      pending_front: stillQueued ? current.pending_front : undefined,
      pending_back: stillQueued ? current.pending_back : undefined,
      needs_scan: stillQueued ? current.needs_scan : false,
    });
  }
  await transaction.done;
  notify();
}

export async function markSyncError(id: string, message: string): Promise<void> {
  const database = await db();
  const transaction = database.transaction("leads", "readwrite");
  const store = transaction.objectStore("leads");
  const current = await store.get(id);
  if (current) await store.put({ ...current, sync_error: message });
  await transaction.done;
  notify();
}

/**
 * Folds rows from the server into the local store.
 *
 * A lead still waiting to be pushed always wins — the person holding the phone
 * made that edit most recently from their point of view, and dropping it would
 * lose a real conversation. Everything else takes the newer `updated_at`.
 */
export async function mergeServerLeads(serverLeads: LocalLead[]): Promise<void> {
  const database = await db();
  const transaction = database.transaction("leads", "readwrite");
  const store = transaction.objectStore("leads");
  for (const incoming of serverLeads) {
    const local = await store.get(incoming.id);
    if (local?.sync_state === "pending") continue;
    if (local && local.updated_at >= incoming.updated_at) continue;
    await store.put({ ...incoming, sync_state: "synced" });
  }
  await transaction.done;
  notify();
}

/* -------------------------------------------------------------------------- */
/* Small key/value settings that should survive a reload                       */
/* -------------------------------------------------------------------------- */

async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db()).get("meta", key) as Promise<T | undefined>;
}

async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put("meta", value, key);
}

export const getActiveEvent = () => getMeta<ExhibitionEvent>("active_event");
export const setActiveEvent = (event: ExhibitionEvent | null) =>
  setMeta("active_event", event ?? undefined);

export const getCachedEvents = () => getMeta<ExhibitionEvent[]>("events");
export const setCachedEvents = (events: ExhibitionEvent[]) => setMeta("events", events);

export const getLastPulledAt = () => getMeta<string>("last_pulled_at");
export const setLastPulledAt = (value: string) => setMeta("last_pulled_at", value);

/** Clears everything on this device. Used by "sign out". */
export async function clearLocalData(): Promise<void> {
  const database = await db();
  await database.clear("leads");
  await database.clear("meta");
  notify();
}
