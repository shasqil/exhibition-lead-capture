"use client";

import { useCallback, useEffect, useState } from "react";
import { Banner, Button, Card, Field, SectionTitle, Select, Spinner } from "./ui";
import { getCachedEvents, setCachedEvents } from "@/lib/local-db";
import { syncNow } from "@/lib/sync";
import type { ExhibitionEvent, LocalLead } from "@/lib/types";

export function ExportPanel({
  event,
  setEvent,
  leads,
  pending,
  online,
}: {
  event: ExhibitionEvent | null;
  setEvent: (event: ExhibitionEvent | null) => void;
  leads: LocalLead[];
  pending: number;
  online: boolean;
}) {
  const [events, setEvents] = useState<ExhibitionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [includeNonLeads, setIncludeNonLeads] = useState(false);

  const load = useCallback(async () => {
    // Show whatever was cached first so the tab is usable with no signal.
    const cached = await getCachedEvents();
    if (cached) setEvents(cached);
    setLoading(false);

    if (!navigator.onLine) return;
    try {
      const response = await fetch("/api/events");
      if (!response.ok) return;
      const { events: fresh } = (await response.json()) as { events: ExhibitionEvent[] };
      setEvents(fresh);
      await setCachedEvents(fresh);
    } catch {
      // Cached list stands.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createEvent() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, location: newLocation.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        event?: ExhibitionEvent;
        error?: string;
      };
      if (!response.ok || !body.event) {
        setError(body.error ?? "Could not create the exhibition.");
        return;
      }
      const next = [body.event, ...events];
      setEvents(next);
      await setCachedEvents(next);
      setEvent(body.event);
      setNewName("");
      setNewLocation("");
    } catch {
      setError("You need a connection to create an exhibition.");
    } finally {
      setCreating(false);
    }
  }

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      // Push anything still queued first, so the file is complete.
      await syncNow();

      const params = new URLSearchParams();
      if (event) params.set("event", event.id);
      if (includeNonLeads) params.set("include_non_leads", "1");
      const response = await fetch(`/api/export?${params}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not build the spreadsheet.");
        return;
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "exhibition-leads.xlsx";

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Download failed. Check your connection and try again.");
    } finally {
      setDownloading(false);
    }
  }

  const forEvent = event ? leads.filter((lead) => lead.event_id === event.id) : leads;

  return (
    <div className="space-y-5 pb-8">
      {error ? (
        <Banner tone="error" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      ) : null}

      <Card>
        <SectionTitle>Current exhibition</SectionTitle>
        {loading ? (
          <Spinner />
        ) : (
          <div className="space-y-3">
            <Select
              label="New leads will be tagged with"
              value={event?.id ?? ""}
              onChange={(id) => setEvent(events.find((candidate) => candidate.id === id) ?? null)}
            >
              <option value="">— none —</option>
              {events.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.location ? ` · ${candidate.location}` : ""}
                </option>
              ))}
            </Select>
            <p className="text-sm text-slate-500">
              {forEvent.length} lead{forEvent.length === 1 ? "" : "s"} on this device
              {event ? ` for ${event.name}` : ""}.
            </p>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Add an exhibition</SectionTitle>
        <div className="space-y-3">
          <Field
            label="Name"
            value={newName}
            onChange={setNewName}
            placeholder="OTC Asia 2026"
          />
          <Field
            label="Location"
            value={newLocation}
            onChange={setNewLocation}
            placeholder="Kuala Lumpur"
            hint="Optional"
          />
          <Button
            variant="secondary"
            onClick={() => void createEvent()}
            disabled={!newName.trim() || creating || !online}
            full
          >
            {creating ? <Spinner /> : null}
            {online ? "Create exhibition" : "Needs a connection"}
          </Button>
        </div>
      </Card>

      <Card>
        <SectionTitle>Export to Excel</SectionTitle>
        <div className="space-y-3">
          {pending > 0 ? (
            <Banner tone="info">
              {pending} lead{pending === 1 ? "" : "s"} on this phone {pending === 1 ? "is" : "are"}{" "}
              still waiting to sync. They&apos;ll be pushed before the file is built.
            </Banner>
          ) : null}

          <label className="flex items-center gap-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={includeNonLeads}
              onChange={(e) => setIncludeNonLeads(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Include the ones marked &ldquo;Not a lead&rdquo;
          </label>

          <Button onClick={() => void download()} disabled={downloading || !online} full>
            {downloading ? <Spinner /> : null}
            {downloading
              ? "Building spreadsheet…"
              : event
                ? `Download ${event.name}`
                : "Download all leads"}
          </Button>

          <p className="text-xs text-slate-500">
            The file covers everyone&apos;s leads, not just yours, and includes a summary tab with
            the count per person and per rating.
          </p>
        </div>
      </Card>
    </div>
  );
}
