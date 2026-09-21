"use client";

import { syncNow } from "@/lib/sync";
import type { SyncStatus } from "@/lib/sync";

/**
 * The one thing someone needs to trust at a booth: has my work left this phone?
 * Tapping it forces a sync so there is always something to do about a red dot.
 */
export function SyncBadge({ status }: { status: SyncStatus }) {
  const { online, syncing, pending, error } = status;

  const tone = !online
    ? "bg-slate-200 text-slate-700"
    : error
      ? "bg-red-100 text-red-800"
      : pending > 0
        ? "bg-amber-100 text-amber-900"
        : "bg-emerald-100 text-emerald-800";

  const label = !online
    ? pending > 0
      ? `Offline · ${pending} saved here`
      : "Offline"
    : syncing
      ? "Syncing…"
      : error
        ? "Sync problem"
        : pending > 0
          ? `${pending} to sync`
          : "All synced";

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={error ?? (online ? "Tap to sync now" : "Your leads are safe on this phone")}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          !online
            ? "bg-slate-500"
            : error
              ? "bg-red-500"
              : pending > 0
                ? "bg-amber-500 animate-pulse"
                : "bg-emerald-500"
        }`}
      />
      {label}
    </button>
  );
}
