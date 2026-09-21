"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { allLeads, getActiveEvent, setActiveEvent, subscribeToLeads } from "@/lib/local-db";
import { getSyncStatus, subscribeToSync, type SyncStatus } from "@/lib/sync";
import type { ExhibitionEvent, LocalLead } from "@/lib/types";

/** Everything captured on this device, newest first, kept live. */
export function useLeads(): { leads: LocalLead[]; loading: boolean; reload: () => void } {
  const [leads, setLeads] = useState<LocalLead[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    void allLeads().then((rows) => {
      setLeads(rows);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    reload();
    return subscribeToLeads(reload);
  }, [reload]);

  return { leads, loading, reload };
}

const SERVER_STATUS: SyncStatus = {
  online: true,
  syncing: false,
  pending: 0,
  lastSyncedAt: null,
  error: null,
};

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeToSync, getSyncStatus, () => SERVER_STATUS);
}

/** The exhibition every new lead gets tagged with, remembered across reloads. */
export function useActiveEvent(): {
  event: ExhibitionEvent | null;
  setEvent: (event: ExhibitionEvent | null) => void;
  loading: boolean;
} {
  const [event, setEventState] = useState<ExhibitionEvent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getActiveEvent().then((stored) => {
      setEventState(stored ?? null);
      setLoading(false);
    });
  }, []);

  const setEvent = useCallback((next: ExhibitionEvent | null) => {
    setEventState(next);
    void setActiveEvent(next);
  }, []);

  return { event, setEvent, loading };
}
