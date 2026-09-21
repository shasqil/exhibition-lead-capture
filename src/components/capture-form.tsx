"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, Button, Field, SectionTitle, Spinner, TextArea } from "./ui";
import { CardPhotos, type CardPhoto } from "./card-photos";
import { RatingPicker } from "./rating-picker";
import { EventSelect } from "./event-select";
import { ProductPicker } from "./product-picker";
import { blobToBase64, compressImage } from "@/lib/image";
import { clearDraft, deleteLead, draftHasContent, getDraft, saveDraft, saveLead } from "@/lib/local-db";
import { syncNow } from "@/lib/sync";
import {
  CARD_FIELDS,
  emptyLead,
  type CardExtraction,
  type CardField,
  type ExhibitionEvent,
  type Lead,
  type LocalLead,
} from "@/lib/types";

interface Props {
  member: string;
  event: ExhibitionEvent | null;
  /** The tickable product list, from the PRODUCTS environment variable. */
  products: string[];
  /** Every exhibition this team has run, for the picker at the top. */
  events: ExhibitionEvent[];
  /** Changes the default show for subsequent captures. */
  onChangeActiveEvent: (event: ExhibitionEvent | null) => void;
  /** Sends the person to the screen where exhibitions are created. */
  onAddEvent: () => void;
  /** Null for a new capture, otherwise the lead being edited. */
  existing?: LocalLead | null;
  onDone: (message: string) => void;
  onCancel?: () => void;
}

export function CaptureForm({
  member,
  event,
  products,
  events,
  onChangeActiveEvent,
  onAddEvent,
  existing,
  onDone,
  onCancel,
}: Props) {
  const [lead, setLead] = useState<Lead>(
    () =>
      existing ??
      emptyLead({
        captured_by: member,
        event_id: event?.id ?? null,
        event_name: event?.name ?? null,
      }),
  );
  const [front, setFront] = useState<CardPhoto>({ url: existing?.card_front_url ?? null });
  const [back, setBack] = useState<CardPhoto>({ url: existing?.card_back_url ?? null });
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<{ tone: "info" | "success" | "error"; text: string } | null>(
    null,
  );
  const [filled, setFilled] = useState<Set<CardField>>(new Set());
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsScan, setNeedsScan] = useState(existing?.needs_scan ?? false);
  const [draftRestored, setDraftRestored] = useState(false);
  // Drafts only apply to a new capture; editing a saved lead already persists.
  const [draftReady, setDraftReady] = useState(Boolean(existing));

  // The form reads `lead` inside an async scan; a ref keeps that read current
  // without making the scan callback change identity on every keystroke.
  const leadRef = useRef(lead);
  useEffect(() => {
    leadRef.current = lead;
  }, [lead]);

  /* --- Autosave ----------------------------------------------------------
   * The form is filled in mid-conversation and the phone will be interrupted:
   * a tab switch, an incoming call, iOS discarding the tab to reclaim memory.
   * Every keystroke is written to the device so none of that costs a lead.
   * ---------------------------------------------------------------------- */

  // Bring back whatever was being typed when the form last went away.
  useEffect(() => {
    if (existing) return;
    let cancelled = false;
    void getDraft().then((draft) => {
      if (cancelled) return;
      if (draftHasContent(draft)) {
        setLead(draft.lead);
        if (draft.front) setFront({ blob: draft.front });
        if (draft.back) setBack({ blob: draft.back });
        setNeedsScan(draft.needs_scan ?? false);
        setDraftRestored(true);
      }
      // Only start writing drafts once any existing one has been read, or the
      // empty initial state would overwrite it first.
      setDraftReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [existing]);

  const latest = useRef({ lead, front, back, needsScan });
  latest.current = { lead, front, back, needsScan };

  /**
   * Set once this form's contents have been dealt with — saved, or cleared on
   * purpose. Without it the flush below runs as the form unmounts after a save
   * and writes the lead straight back as a draft, which the next form then
   * restores: the lead you just filed reappears on the blank form behind it.
   */
  const committed = useRef(false);

  useEffect(() => {
    if (existing || !draftReady) return;
    // Debounced so a fast typist is not writing to IndexedDB per character.
    const timer = setTimeout(() => {
      if (committed.current) return;
      const { lead: current, front: f, back: b, needsScan: scan } = latest.current;
      void saveDraft({ lead: current, front: f.blob, back: b.blob, needs_scan: scan });
    }, 400);
    return () => clearTimeout(timer);
  }, [lead, front, back, needsScan, existing, draftReady]);

  // A pending debounce would be lost when the form unmounts on a tab switch,
  // so flush on the way out.
  //
  // `draftReady` gates this for the same reason it gates the debounce: until
  // the stored draft has been read, this component's state is the empty form,
  // and flushing that would erase the very draft we are about to restore.
  // React's development double-mount makes this fire immediately, but the race
  // is real in production too — leaving the tab within a few milliseconds of
  // opening it would otherwise wipe the draft.
  useEffect(() => {
    if (existing || !draftReady) return;
    return () => {
      if (committed.current) return;
      const { lead: current, front: f, back: b, needsScan: scan } = latest.current;
      void saveDraft({ lead: current, front: f.blob, back: b.blob, needs_scan: scan });
    };
  }, [existing, draftReady]);

  const set = useCallback(<K extends keyof Lead>(key: K, value: Lead[K]) => {
    setLead((current) => ({ ...current, [key]: value }));
  }, []);

  /** Sends whatever photos we have to Claude and fills the blanks it can. */
  const runScan = useCallback(async (blobs: (Blob | undefined)[]) => {
    const images = blobs.filter((blob): blob is Blob => Boolean(blob));
    if (images.length === 0) return;

    if (!navigator.onLine) {
      setNeedsScan(true);
      setScanNote({
        tone: "info",
        text: "No signal — the card will be read automatically once you're back online.",
      });
      return;
    }

    setScanning(true);
    setScanNote(null);
    try {
      const payload = await Promise.all(
        images.map(async (blob) => ({
          base64: await blobToBase64(blob),
          media_type: blob.type || "image/jpeg",
        })),
      );
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: payload, event_name: leadRef.current.event_name }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not read the card.");
      }

      const { fields } = (await response.json()) as { fields: CardExtraction };
      const current = leadRef.current;
      const touched = new Set<CardField>();
      const patch: Partial<Lead> = {};
      for (const field of CARD_FIELDS) {
        const value = fields[field];
        // Never overwrite something typed by hand — the person at the booth
        // heard the name said out loud, the camera only saw the print.
        if (value && !current[field].trim()) {
          patch[field] = value;
          touched.add(field);
        }
      }

      setNeedsScan(false);
      if (touched.size === 0) {
        // "Nothing new" reads as "the photo failed", when usually the photo
        // was fine and the form was simply already full. Say which.
        const readAnything = CARD_FIELDS.some((field) => fields[field]);
        setScanNote(
          readAnything
            ? {
                tone: "info",
                text: "Everything on that card is already filled in. Tap Clear if this is a new person.",
              }
            : {
                tone: "error",
                text: "Couldn't read anything from that photo. Try again in better light, or type it in.",
              },
        );
        return;
      }
      setLead((previous) => ({ ...previous, ...patch }));
      setFilled((previous) => new Set([...previous, ...touched]));
      if (touched.has("address") || touched.has("country") || touched.has("website")) {
        setShowMore(true);
      }
      setScanNote({
        tone: "success",
        text: `Filled in ${touched.size} field${touched.size === 1 ? "" : "s"}. Check them before saving.`,
      });
    } catch (error) {
      setNeedsScan(false);
      setScanNote({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not read the card.",
      });
    } finally {
      setScanning(false);
    }
  }, []);

  async function pickPhoto(side: "front" | "back", file: File) {
    const blob = await compressImage(file);
    if (side === "front") {
      setFront({ blob });
      await runScan([blob, back.blob]);
    } else {
      setBack({ blob });
      await runScan([front.blob, blob]);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const record: LocalLead = {
        ...lead,
        captured_by: member,
        // The picker above is the only thing that sets this now, so whatever
        // it holds is deliberate — including "none". Falling back to the
        // active event here would silently undo clearing it.
        event_id: lead.event_id,
        event_name: lead.event_name,
        card_front_url: front.url ?? null,
        card_back_url: back.url ?? null,
        sync_state: "pending",
        pending_front: front.blob,
        pending_back: back.blob,
        needs_scan: needsScan,
      };
      // Before the draft is touched: from here on nothing may write this
      // lead back as work in progress.
      committed.current = true;
      await saveLead(record);
      if (!existing) await clearDraft();
      void syncNow();
      onDone(existing ? "Lead updated." : "Lead saved.");
    } catch (error) {
      // The lead is still on screen and still unsaved, so it must go back to
      // being drafted or an interruption now would lose it.
      committed.current = false;
      setScanNote({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not save. Try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  /** Wipes the form back to blank, keeping the show and who is capturing. */
  function clearForm() {
    const hasContent =
      Boolean(front.blob || back.blob) ||
      [
        lead.full_name, lead.job_title, lead.company, lead.email, lead.phone,
        lead.mobile, lead.website, lead.address, lead.country,
        lead.products_discussed, lead.notes, lead.follow_up,
      ].some((value) => value.trim());
    if (hasContent && !window.confirm("Clear this form? Anything typed will be lost.")) {
      return;
    }

    void clearDraft();
    setLead(
      emptyLead({
        captured_by: member,
        // The exhibition is the day's setting, not this lead's data.
        event_id: lead.event_id,
        event_name: lead.event_name,
      }),
    );
    setFront({ url: null });
    setBack({ url: null });
    setFilled(new Set());
    setScanNote(null);
    setNeedsScan(false);
    setDraftRestored(false);
  }

  async function remove() {
    if (!existing) return;
    if (!window.confirm("Delete this lead? It will be removed for everyone.")) return;
    await deleteLead(existing.id);
    void syncNow();
    onDone("Lead deleted.");
  }

  const highlight = (field: CardField) => filled.has(field);

  const capturedLabel = new Date(lead.captured_at).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="space-y-5">
      {draftRestored ? (
        <Banner tone="info" onDismiss={() => setDraftRestored(false)}>
          Picked up where you left off. This lead is not saved yet.
        </Banner>
      ) : null}

      <EventSelect
        events={events}
        value={lead.event_id}
        scope={existing ? "existing" : "new"}
        onAddNew={existing ? undefined : onAddEvent}
        onChange={(picked) => {
          setLead((current) => ({
            ...current,
            event_id: picked?.id ?? null,
            event_name: picked?.name ?? null,
          }));
          // Setting it on a new capture also sets the default for the next
          // one — you pick your show once at the start of the day. Editing a
          // saved lead only ever moves that one lead.
          if (!existing) onChangeActiveEvent(picked);
        }}
      />

      <CardPhotos
        front={front}
        back={back}
        onPickFront={(file) => void pickPhoto("front", file)}
        onPickBack={(file) => void pickPhoto("back", file)}
        onClearFront={() => setFront({ url: null })}
        onClearBack={() => setBack({ url: null })}
        scanning={scanning}
      />

      {scanNote ? (
        <Banner tone={scanNote.tone} onDismiss={() => setScanNote(null)}>
          {scanNote.text}
        </Banner>
      ) : null}

      <RatingPicker value={lead.rating} onChange={(rating) => set("rating", rating)} />

      <div className="space-y-3">
        <SectionTitle>Contact</SectionTitle>
        <Field
          label="Name"
          value={lead.full_name}
          onChange={(value) => set("full_name", value)}
          placeholder="Jane Tan"
          autoComplete="name"
          highlighted={highlight("full_name")}
        />
        <Field
          label="Company"
          value={lead.company}
          onChange={(value) => set("company", value)}
          placeholder="Acme Offshore Pte Ltd"
          highlighted={highlight("company")}
        />
        <Field
          label="Job title"
          value={lead.job_title}
          onChange={(value) => set("job_title", value)}
          placeholder="Procurement Manager"
          highlighted={highlight("job_title")}
        />
        <Field
          label="Email"
          value={lead.email}
          onChange={(value) => set("email", value)}
          type="email"
          inputMode="email"
          placeholder="jane@acme.com"
          highlighted={highlight("email")}
        />
        <Field
          label="Mobile"
          value={lead.mobile}
          onChange={(value) => set("mobile", value)}
          type="tel"
          inputMode="tel"
          placeholder="+65 9123 4567"
          highlighted={highlight("mobile")}
        />

        {showMore ? (
          <div className="space-y-3 border-l-2 border-slate-200 pl-3">
            <Field
              label="Office phone"
              value={lead.phone}
              onChange={(value) => set("phone", value)}
              type="tel"
              inputMode="tel"
              highlighted={highlight("phone")}
            />
            <Field
              label="Website"
              value={lead.website}
              onChange={(value) => set("website", value)}
              inputMode="url"
              highlighted={highlight("website")}
            />
            <Field
              label="Address"
              value={lead.address}
              onChange={(value) => set("address", value)}
              highlighted={highlight("address")}
            />
            <Field
              label="Country"
              value={lead.country}
              onChange={(value) => set("country", value)}
              highlighted={highlight("country")}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowMore(true)}
            className="text-sm font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900"
          >
            + Phone, website, address
          </button>
        )}
      </div>

      <div className="space-y-3">
        <SectionTitle>The conversation</SectionTitle>
        <TextArea
          label="What we talked about"
          value={lead.notes}
          onChange={(value) => set("notes", value)}
          rows={5}
          placeholder="Runs 3 FPSOs in West Africa. Unhappy with current PFP vendor — lead times. Wants a quote for hull blasting by Q1."
          hint="The bit you'll forget by Friday"
        />
        <ProductPicker
          options={products}
          value={lead.products_discussed}
          onChange={(value) => set("products_discussed", value)}
        />
        <Field
          label="Follow-up action"
          value={lead.follow_up}
          onChange={(value) => set("follow_up", value)}
          placeholder="Send capability statement + price list"
        />
      </div>

      <p className="text-center text-xs text-slate-400">
        {existing ? "Captured" : "Started"} {capturedLabel}
      </p>

      {existing ? (
        <Button variant="danger" onClick={() => void remove()} full>
          Delete lead
        </Button>
      ) : null}

      {/*
        Sticky inside the scrolling area, not fixed to the viewport. Fixed put
        it underneath the tab bar, which sits at the same edge with a higher
        stacking order — the button was on screen but unreachable.
      */}
      <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white px-4 pb-3 pt-3 shadow-[0_-10px_20px_-12px_rgba(15,23,42,0.25)]">
        <div className="flex gap-2">
          {onCancel ? (
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button variant="secondary" onClick={clearForm} disabled={saving || scanning}>
              Clear
            </Button>
          )}
          <Button onClick={() => void save()} disabled={saving || scanning} full>
            {saving ? <Spinner /> : null}
            {existing ? "Save changes" : "Save lead"}
          </Button>
        </div>
        {existing ? null : (
          <p className="mt-1.5 text-center text-xs text-slate-400">
            Kept on this phone as you type — you won&apos;t lose it if you tap away.
          </p>
        )}
      </div>
    </div>
  );
}
