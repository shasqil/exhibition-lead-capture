"use client";

import type { ExhibitionEvent } from "@/lib/types";

const ADD_NEW = "__add__";

/**
 * Which show this lead belongs to.
 *
 * Sits at the top of the capture form because that is when it is true: a lead
 * is tagged the moment it is captured, not when it is exported. On a new lead
 * the choice also becomes the default for the next one, so it is set once per
 * show rather than once per person.
 */
export function EventSelect({
  events,
  value,
  onChange,
  onAddNew,
  /** Copy changes between "the next lead I capture" and "this saved lead". */
  scope,
}: {
  events: ExhibitionEvent[];
  value: string | null;
  onChange: (event: ExhibitionEvent | null) => void;
  onAddNew?: () => void;
  scope: "new" | "existing";
}) {
  const selected = events.find((candidate) => candidate.id === value) ?? null;
  // A lead captured under an exhibition that has since been deleted must not
  // silently jump to "none", so keep showing what it was tagged with.
  const missing = value !== null && !selected;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <span aria-hidden="true" className="text-base">
        🎪
      </span>
      <label className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {scope === "new" ? "Capturing for" : "Exhibition"}
        </span>
        <select
          value={missing ? "" : (value ?? "")}
          onChange={(event) => {
            if (event.target.value === ADD_NEW) {
              onAddNew?.();
              return;
            }
            onChange(events.find((item) => item.id === event.target.value) ?? null);
          }}
          className="-ml-0.5 w-full border-0 bg-transparent p-0 text-sm font-semibold text-slate-900 outline-none focus:ring-0"
        >
          <option value="">{missing ? "— exhibition removed —" : "— none —"}</option>
          {events.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
              {candidate.location ? ` · ${candidate.location}` : ""}
            </option>
          ))}
          {onAddNew ? <option value={ADD_NEW}>＋ Add an exhibition…</option> : null}
        </select>
      </label>
    </div>
  );
}
