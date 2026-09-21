"use client";

import { useCallback, useEffect, useState } from "react";
import { getCachedEvents, setCachedEvents } from "@/lib/local-db";
import type { ExhibitionEvent } from "@/lib/types";

export interface EventsState {
  events: ExhibitionEvent[];
  loading: boolean;
  /** Creates an exhibition on the server and returns it, or null with a reason. */
  create: (
    fields: { name: string; location?: string },
  ) => Promise<{ event: ExhibitionEvent } | { error: string }>;
}

/**
 * The exhibitions this team has run.
 *
 * Shared by the capture screen and the export screen so both see the same
 * list. Reads the cached copy first: at a booth the list rarely changes, and
 * the picker has to work with no signal.
 */
export function useEvents(): EventsState {
  const [events, setEvents] = useState<ExhibitionEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const cached = await getCachedEvents();
      if (!cancelled && cached) setEvents(cached);
      if (!cancelled) setLoading(false);

      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      try {
        const response = await fetch("/api/events");
        if (!response.ok) return;
        const { events: fresh } = (await response.json()) as { events: ExhibitionEvent[] };
        if (cancelled) return;
        setEvents(fresh);
        await setCachedEvents(fresh);
      } catch {
        // The cached list stands; this is not worth interrupting anyone over.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const create = useCallback<EventsState["create"]>(async (fields) => {
    const name = fields.name.trim();
    if (!name) return { error: "Give the exhibition a name." };
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, location: fields.location?.trim() ?? "" }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        event?: ExhibitionEvent;
        error?: string;
      };
      if (!response.ok || !body.event) {
        return { error: body.error ?? "Could not create the exhibition." };
      }
      const created = body.event;
      setEvents((current) => {
        const next = [created, ...current];
        void setCachedEvents(next);
        return next;
      });
      return { event: created };
    } catch {
      return { error: "You need a connection to create an exhibition." };
    }
  }, []);

  return { events, loading, create };
}
