"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CaptureForm } from "./capture-form";
import { ExportPanel } from "./export-panel";
import { LeadsList } from "./leads-list";
import { SyncBadge } from "./sync-badge";
import { Banner } from "./ui";
import { useActiveEvent, useLeads, useSyncStatus } from "@/hooks/use-leads";
import { clearLocalData } from "@/lib/local-db";
import { startSync, syncNow } from "@/lib/sync";
import type { LocalLead } from "@/lib/types";

type Tab = "capture" | "leads" | "export";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "capture", label: "Capture", icon: "＋" },
  { id: "leads", label: "Leads", icon: "☰" },
  { id: "export", label: "Export", icon: "↓" },
];

export function App({ member }: { member: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("capture");
  const [editing, setEditing] = useState<LocalLead | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Bumped after a save so the capture form resets for the next person. */
  const [formKey, setFormKey] = useState(0);

  const { leads, loading } = useLeads();
  const status = useSyncStatus();
  const { event, setEvent } = useActiveEvent();

  useEffect(() => {
    startSync();
    // A service worker is what makes the app open at all with no signal.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Not fatal — the app still works, it just will not open offline.
      });
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  async function signOut() {
    if (status.pending > 0) {
      const proceed = window.confirm(
        `${status.pending} lead(s) have not reached the server yet. Sign out anyway and lose them?`,
      );
      if (!proceed) {
        void syncNow();
        return;
      }
    }
    await clearLocalData();
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  function finishEditing(message: string) {
    setEditing(null);
    setToast(message);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-slate-100">
      <header className="pt-safe sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 pb-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold text-slate-900">
              {event?.name ?? "Lead Capture"}
            </h1>
            <p className="truncate text-xs text-slate-500">
              {member}
              {event?.location ? ` · ${event.location}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SyncBadge status={status} />
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {toast ? (
        <div className="px-4 pt-3">
          <Banner tone="success">{toast}</Banner>
        </div>
      ) : null}

      {status.error && status.online ? (
        <div className="px-4 pt-3">
          <Banner tone="error">
            {status.error} Your leads are safe on this phone — tap the badge to retry.
          </Banner>
        </div>
      ) : null}

      <main className="flex-1 px-4 py-4">
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="mb-3 text-sm font-semibold text-slate-600 hover:text-slate-900"
            >
              ← Back to leads
            </button>
            <CaptureForm
              key={editing.id}
              member={member}
              event={event}
              existing={editing}
              onDone={finishEditing}
              onCancel={() => setEditing(null)}
            />
          </>
        ) : tab === "capture" ? (
          <CaptureForm
            key={formKey}
            member={member}
            event={event}
            onDone={(message) => {
              setToast(message);
              setFormKey((value) => value + 1);
            }}
          />
        ) : tab === "leads" ? (
          <LeadsList leads={leads} loading={loading} onOpen={setEditing} />
        ) : (
          <ExportPanel
            event={event}
            setEvent={setEvent}
            leads={leads}
            pending={status.pending}
            online={status.online}
          />
        )}
      </main>

      {editing ? null : (
        <nav className="pb-safe sticky bottom-0 z-20 grid grid-cols-3 border-t border-slate-200 bg-white/95 pt-1 backdrop-blur">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-xs font-semibold transition-colors ${
                tab === item.id ? "text-slate-900" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <span className="text-lg leading-none" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
              {item.id === "leads" && leads.length > 0 ? (
                <span className="sr-only">{leads.length} leads</span>
              ) : null}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
