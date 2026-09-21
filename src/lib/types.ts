/** The four buckets a lead can be sorted into at the booth. */
export const RATINGS = ["hot", "warm", "cold", "not_a_lead"] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_LABELS: Record<Rating, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
  not_a_lead: "Not a lead",
};

/** Tailwind classes per rating, used by the picker and the list chips. */
export const RATING_STYLES: Record<Rating, { on: string; off: string; dot: string }> = {
  hot: {
    on: "bg-red-600 text-white border-red-600",
    off: "bg-white text-red-700 border-red-300 hover:bg-red-50",
    dot: "bg-red-500",
  },
  warm: {
    on: "bg-amber-500 text-white border-amber-500",
    off: "bg-white text-amber-700 border-amber-300 hover:bg-amber-50",
    dot: "bg-amber-500",
  },
  cold: {
    on: "bg-sky-600 text-white border-sky-600",
    off: "bg-white text-sky-700 border-sky-300 hover:bg-sky-50",
    dot: "bg-sky-500",
  },
  not_a_lead: {
    on: "bg-slate-600 text-white border-slate-600",
    off: "bg-white text-slate-600 border-slate-300 hover:bg-slate-50",
    dot: "bg-slate-400",
  },
};

export function isRating(value: unknown): value is Rating {
  return typeof value === "string" && (RATINGS as readonly string[]).includes(value);
}

/**
 * The fields the card scanner tries to fill in. Kept separate from `Lead` so the
 * Anthropic tool schema and the "which fields did the scan touch" highlight can
 * both be derived from one list.
 */
export const CARD_FIELDS = [
  "full_name",
  "job_title",
  "company",
  "email",
  "phone",
  "mobile",
  "website",
  "address",
  "country",
] as const;
export type CardField = (typeof CARD_FIELDS)[number];

export type CardExtraction = Partial<Record<CardField, string>>;

/**
 * A captured lead. The `id` is generated on the device so a lead saved with no
 * signal keeps its identity when it finally reaches the server — the server
 * upserts on this id, which makes re-sending a lead harmless.
 */
export interface Lead {
  id: string;
  event_id: string | null;
  event_name: string | null;
  captured_by: string;
  captured_at: string;
  rating: Rating;

  full_name: string;
  job_title: string;
  company: string;
  email: string;
  phone: string;
  mobile: string;
  website: string;
  address: string;
  country: string;

  products_discussed: string;
  notes: string;
  follow_up: string;
  follow_up_by: string;

  card_front_url: string | null;
  card_back_url: string | null;

  updated_at: string;
  deleted: boolean;
}

/** Device-only bookkeeping. Never sent to the server, never exported. */
export interface LocalLead extends Lead {
  /** "pending" until the server has acknowledged this exact `updated_at`. */
  sync_state: "pending" | "synced";
  /** Photos waiting to be uploaded, held as blobs in IndexedDB. */
  pending_front?: Blob;
  pending_back?: Blob;
  /** Set when the card was photographed offline and still needs reading. */
  needs_scan?: boolean;
  /** Last sync error, surfaced in the UI so a stuck lead is never silent. */
  sync_error?: string;
}

export interface ExhibitionEvent {
  id: string;
  name: string;
  location: string;
  starts_on: string;
  ends_on: string;
}

export interface Session {
  member: string;
}

export function emptyLead(overrides: Partial<Lead> = {}): Lead {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    event_id: null,
    event_name: null,
    captured_by: "",
    captured_at: now,
    rating: "warm",
    full_name: "",
    job_title: "",
    company: "",
    email: "",
    phone: "",
    mobile: "",
    website: "",
    address: "",
    country: "",
    products_discussed: "",
    notes: "",
    follow_up: "",
    follow_up_by: "",
    card_front_url: null,
    card_back_url: null,
    updated_at: now,
    deleted: false,
    ...overrides,
  };
}

/** Strips device-only keys so what we send to the server matches the table. */
export function toWireLead(lead: LocalLead | Lead): Lead {
  const {
    id,
    event_id,
    event_name,
    captured_by,
    captured_at,
    rating,
    full_name,
    job_title,
    company,
    email,
    phone,
    mobile,
    website,
    address,
    country,
    products_discussed,
    notes,
    follow_up,
    follow_up_by,
    card_front_url,
    card_back_url,
    updated_at,
    deleted,
  } = lead;
  return {
    id,
    event_id,
    event_name,
    captured_by,
    captured_at,
    rating,
    full_name,
    job_title,
    company,
    email,
    phone,
    mobile,
    website,
    address,
    country,
    products_discussed,
    notes,
    follow_up,
    follow_up_by,
    card_front_url,
    card_back_url,
    updated_at,
    deleted,
  };
}

/** A one-line summary for the leads list. */
export function leadHeadline(lead: Lead): string {
  return lead.full_name.trim() || lead.company.trim() || lead.email.trim() || "Untitled lead";
}

export function leadSubline(lead: Lead): string {
  const headline = leadHeadline(lead);
  return [lead.job_title.trim(), lead.company.trim()]
    .filter((part) => part && part !== headline)
    .join(" · ");
}
