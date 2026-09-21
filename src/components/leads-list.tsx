"use client";

import { useMemo, useState } from "react";
import {
  RATINGS,
  RATING_LABELS,
  RATING_STYLES,
  leadHeadline,
  leadSubline,
  type LocalLead,
  type Rating,
} from "@/lib/types";
import { Spinner } from "./ui";

function matches(lead: LocalLead, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    lead.full_name,
    lead.company,
    lead.job_title,
    lead.email,
    lead.notes,
    lead.products_discussed,
    lead.country,
    lead.event_name ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function whenCaptured(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function LeadsList({
  leads,
  loading,
  onOpen,
}: {
  leads: LocalLead[];
  loading: boolean;
  onOpen: (lead: LocalLead) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Rating | "all">("all");
  /** "" means the leads with no exhibition; "all" means don't filter. */
  const [show, setShow] = useState<string>("all");

  // Taken from the leads themselves rather than the events list, so it only
  // offers shows that actually have leads on this device.
  const exhibitions = useMemo(() => {
    const names = new Set<string>();
    for (const lead of leads) names.add(lead.event_name ?? "");
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [leads]);

  const forShow = useMemo(
    () => (show === "all" ? leads : leads.filter((lead) => (lead.event_name ?? "") === show)),
    [leads, show],
  );

  // Counts follow the chosen exhibition, so the numbers match what is listed.
  const counts = useMemo(() => {
    const tally: Record<Rating, number> = { hot: 0, warm: 0, cold: 0, not_a_lead: 0 };
    for (const lead of forShow) tally[lead.rating] += 1;
    return tally;
  }, [forShow]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return forShow.filter(
      (lead) => (active === "all" || lead.rating === active) && matches(lead, needle),
    );
  }, [forShow, query, active]);

  if (loading) {
    return (
      <div className="flex justify-center py-12 text-slate-400">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search name, company, notes…"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
      />

      {exhibitions.length > 1 ? (
        <select
          value={show}
          onChange={(event) => setShow(event.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
        >
          <option value="all">🎪 All exhibitions ({leads.length})</option>
          {exhibitions.map((name) => (
            <option key={name || "__none__"} value={name}>
              {name || "Not tagged"} (
              {leads.filter((lead) => (lead.event_name ?? "") === name).length})
            </option>
          ))}
        </select>
      ) : null}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <FilterChip
          label="All"
          count={forShow.length}
          selected={active === "all"}
          onClick={() => setActive("all")}
        />
        {RATINGS.map((rating) => (
          <FilterChip
            key={rating}
            label={RATING_LABELS[rating]}
            count={counts[rating]}
            selected={active === rating}
            dot={RATING_STYLES[rating].dot}
            onClick={() => setActive(active === rating ? "all" : rating)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">
          {leads.length === 0
            ? "No leads yet. Tap Capture to add the first one."
            : show !== "all" && forShow.length === 0
              ? `No leads for ${show || "leads without an exhibition"} on this device.`
              : "Nothing matches that filter."}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((lead) => (
            <li key={lead.id}>
              <button
                type="button"
                onClick={() => onOpen(lead)}
                className="flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${RATING_STYLES[lead.rating].dot}`}
                  aria-label={RATING_LABELS[lead.rating]}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold text-slate-900">
                      {leadHeadline(lead)}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {whenCaptured(lead.captured_at)}
                    </span>
                  </span>
                  {leadSubline(lead) ? (
                    <span className="block truncate text-sm text-slate-500">
                      {leadSubline(lead)}
                    </span>
                  ) : null}
                  {lead.notes.trim() ? (
                    <span className="mt-1 block line-clamp-2 text-sm text-slate-600">
                      {lead.notes}
                    </span>
                  ) : null}
                  <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    {lead.event_name ? (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                        {lead.event_name}
                      </span>
                    ) : (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
                        No exhibition
                      </span>
                    )}
                    <span className="text-slate-400">{lead.captured_by}</span>
                    {lead.sync_error ? (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700">
                        Not synced
                      </span>
                    ) : lead.sync_state === "pending" ? (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
                        Waiting to sync
                      </span>
                    ) : null}
                    {lead.needs_scan ? (
                      <span className="rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700">
                        Card unread
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  selected,
  onClick,
  dot,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
  dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
        selected
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {dot ? <span className={`h-2 w-2 rounded-full ${dot}`} /> : null}
      {label}
      <span className={selected ? "opacity-70" : "text-slate-400"}>{count}</span>
    </button>
  );
}
