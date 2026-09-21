import { isRating, type Lead } from "./types";

function text(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nullableText(value: unknown, max = 2000): string | null {
  const result = text(value, max);
  return result || null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function uuidOrNull(value: unknown): string | null {
  const result = text(value, 36);
  return UUID.test(result) ? result : null;
}

function timestamp(value: unknown): string {
  const result = text(value, 40);
  const parsed = Date.parse(result);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

/**
 * Rebuilds a lead from untrusted JSON, dropping anything unexpected.
 *
 * Returns null when the row has no usable id — there is nothing sensible to
 * store it under, and inventing one would create a duplicate on the next push.
 */
export function normaliseLead(input: unknown, capturedBy: string): Lead | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const id = uuidOrNull(raw.id);
  if (!id) return null;

  const followUpBy = text(raw.follow_up_by, 10);

  return {
    id,
    event_id: uuidOrNull(raw.event_id),
    event_name: nullableText(raw.event_name, 200),
    // The signed-in name is trusted over whatever the body claims.
    captured_by: capturedBy,
    captured_at: timestamp(raw.captured_at),
    rating: isRating(raw.rating) ? raw.rating : "warm",

    full_name: text(raw.full_name, 200),
    job_title: text(raw.job_title, 200),
    company: text(raw.company, 200),
    email: text(raw.email, 320).toLowerCase(),
    phone: text(raw.phone, 60),
    mobile: text(raw.mobile, 60),
    website: text(raw.website, 300),
    address: text(raw.address, 500),
    country: text(raw.country, 100),

    products_discussed: text(raw.products_discussed, 1000),
    notes: text(raw.notes, 5000),
    follow_up: text(raw.follow_up, 1000),
    follow_up_by: ISO_DATE.test(followUpBy) ? followUpBy : "",

    card_front_url: nullableText(raw.card_front_url, 500),
    card_back_url: nullableText(raw.card_back_url, 500),

    updated_at: timestamp(raw.updated_at),
    deleted: raw.deleted === true,
  };
}

/** Postgres wants null, not "", for an empty date. */
export function leadToRow(lead: Lead): Record<string, unknown> {
  return { ...lead, follow_up_by: lead.follow_up_by || null };
}

/** And the client wants "", not null, so its form inputs stay controlled. */
export function rowToLead(row: Record<string, unknown>): Lead {
  const lead = normaliseLead(row, text(row.captured_by, 200));
  // Rows come from our own table, so the shape is known; this only ever trips
  // if someone edits a row in Supabase and clears the id, which cannot happen.
  if (!lead) throw new Error("Lead row is missing its id");
  return lead;
}
