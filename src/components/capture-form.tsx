"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, Button, Field, SectionTitle, Spinner, TextArea } from "./ui";
import { CardPhotos, type CardPhoto } from "./card-photos";
import { RatingPicker } from "./rating-picker";
import { blobToBase64, compressImage } from "@/lib/image";
import { deleteLead, saveLead } from "@/lib/local-db";
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
  /** Null for a new capture, otherwise the lead being edited. */
  existing?: LocalLead | null;
  onDone: (message: string) => void;
  onCancel?: () => void;
}

export function CaptureForm({ member, event, existing, onDone, onCancel }: Props) {
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

  // The form reads `lead` inside an async scan; a ref keeps that read current
  // without making the scan callback change identity on every keystroke.
  const leadRef = useRef(lead);
  useEffect(() => {
    leadRef.current = lead;
  }, [lead]);

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
        body: JSON.stringify({ images: payload }),
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
        setScanNote({ tone: "info", text: "Nothing new found on that photo." });
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
        // Re-stamp the event on every save so a lead started before the event
        // was chosen still lands under the right show.
        event_id: lead.event_id ?? event?.id ?? null,
        event_name: lead.event_name ?? event?.name ?? null,
        card_front_url: front.url ?? null,
        card_back_url: back.url ?? null,
        sync_state: "pending",
        pending_front: front.blob,
        pending_back: back.blob,
        needs_scan: needsScan,
      };
      await saveLead(record);
      void syncNow();
      onDone(existing ? "Lead updated." : "Lead saved.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!window.confirm("Delete this lead? It will be removed for everyone.")) return;
    await deleteLead(existing.id);
    void syncNow();
    onDone("Lead deleted.");
  }

  const highlight = (field: CardField) => filled.has(field);

  return (
    <div className="space-y-5 pb-28">
      {event ? null : (
        <Banner tone="info">
          No exhibition selected. Pick one on the <strong>Export</strong> tab so your leads are
          grouped properly.
        </Banner>
      )}

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
        <Field
          label="Products discussed"
          value={lead.products_discussed}
          onChange={(value) => set("products_discussed", value)}
          placeholder="PFP coating, scaffolding"
        />
        <Field
          label="Follow-up action"
          value={lead.follow_up}
          onChange={(value) => set("follow_up", value)}
          placeholder="Send capability statement + price list"
        />
        <Field
          label="Follow up by"
          value={lead.follow_up_by}
          onChange={(value) => set("follow_up_by", value)}
          type="date"
        />
      </div>

      {existing ? (
        <Button variant="danger" onClick={() => void remove()} full>
          Delete lead
        </Button>
      ) : null}

      <div className="pb-safe fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg gap-2">
          {onCancel ? (
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button onClick={() => void save()} disabled={saving || scanning} full>
            {saving ? <Spinner /> : null}
            {existing ? "Save changes" : "Save lead"}
          </Button>
        </div>
      </div>
    </div>
  );
}
