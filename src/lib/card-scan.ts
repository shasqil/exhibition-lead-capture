import Anthropic from "@anthropic-ai/sdk";
import { CARD_FIELDS, type CardExtraction } from "./types";

/** Sonnet is plenty for reading a card and keeps the per-scan cost near a cent. */
const DEFAULT_MODEL = "claude-sonnet-5";

/** Anthropic accepts these four for images; anything else is rejected upstream. */
const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export type CardMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

export function isAllowedMediaType(value: string): value is CardMediaType {
  return (ALLOWED_MEDIA_TYPES as readonly string[]).includes(value);
}

export interface CardImage {
  base64: string;
  mediaType: CardMediaType;
}

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "record_card_details",
  description:
    "Record the contact details printed on a business card or an exhibition badge. " +
    "Call this exactly once, after looking at every image provided.",
  input_schema: {
    type: "object",
    properties: {
      full_name: { type: "string", description: "Person's full name as printed, without honorifics." },
      job_title: { type: "string", description: "Job title or role." },
      company: { type: "string", description: "Company or organisation name." },
      email: { type: "string", description: "Email address, lowercased." },
      phone: { type: "string", description: "Main office or landline number, with country code if shown." },
      mobile: { type: "string", description: "Mobile or cell number, with country code if shown." },
      website: { type: "string", description: "Website, without the http:// prefix." },
      address: { type: "string", description: "Full postal address on one line, excluding the country." },
      country: { type: "string", description: "Country, in English." },
    },
    required: [],
  },
};

const BASE_PROMPT = [
  "You read photographs of business cards and exhibition badges, and pull out the contact details of the person they belong to.",
  "",
  "Rules:",
  "- The images may be the front and back of the same card or badge. Treat them as one item and merge what you find.",
  "- Many cards print one side in English and the other in another language. Prefer the English spelling for names and companies; if only a non-Latin script is present, transliterate it and keep the original in the address field if it is an address.",
  "- Copy what is printed. Do not guess, complete, or correct an email address, phone number or URL.",
  "- Leave a field out entirely rather than filling it with a placeholder, 'N/A', or a guess.",
  "- If an image is too blurred or dark to read, leave the affected fields out.",
  "",
  "If the photograph is an exhibition badge rather than a business card:",
  "- The person's own name is usually the largest text. Their employer is normally printed directly beneath it, in smaller text.",
  "- The name of the exhibition itself, and any organiser or sponsor logos, are printed on every badge in the hall. They are never this person's employer. Do not put them in 'company'.",
  "- Words describing why someone is at the show \u2014 Visitor, Attendee, Delegate, Exhibitor, Speaker, Press, Media, Organiser, Staff, Crew, Student, VIP, Buyer \u2014 are badge categories, not job titles. Leave 'job_title' out unless a real role is printed.",
  "- Ignore registration numbers, barcodes, QR codes and any bare string of digits. They identify the badge, not the person.",
  "- Badges usually carry no email or phone at all. That is normal; leave those fields out rather than taking a number from the organiser's own printing.",
  "- A country printed on a badge is the person's country. Record it.",
  "",
  "Telephone numbers — decide 'mobile' vs 'phone' in this order:",
  "1. Go by the printed label. These mean MOBILE: M, Mob, Mobile, Cell, Cell., C, HP, H/P, H/P., Hand phone, Handphone, WhatsApp, WA, 手机, 手機, Móvil. These mean OFFICE: T, Tel, Tel., Ph, Phone, O, Off, Office, DID, D, Direct, Main, Switchboard, 电话.",
  "2. Never put a fax number in either field. F, Fax, Facsimile and 传真 are fax — leave them out entirely.",
  "3. If exactly one number is labelled and one is not, the unlabelled one is the other kind.",
  "4. If nothing is labelled, use the number's own shape. A Singapore number beginning 8 or 9 is mobile and one beginning 6 is an office line. A Malaysian number beginning 01 is mobile. An Indonesian number beginning 08 or +628 is mobile. A number with an extension ('ext', 'x', '#') is always an office line.",
  "5. If you still cannot tell, put it in 'phone' and leave 'mobile' out. A number in the wrong box is worse than an empty box.",
].join("\n");

/**
 * Every badge in the hall carries the exhibition's own name and logo, and it
 * is the single most likely thing to be mistaken for the person's employer.
 * Naming it outright is far more reliable than describing it.
 */
function systemPrompt(eventName?: string): string {
  if (!eventName) return BASE_PROMPT;
  return [
    BASE_PROMPT,
    "",
    `This photograph was taken at an exhibition called "${eventName}". That name, and any variation of it, is the event \u2014 never the person's company. If it is the only organisation you can see, leave 'company' out.`,
  ].join("\n");
}

/**
 * Sends the card photos to Claude and returns whatever it could read.
 *
 * Returns only the fields that came back non-empty, so the caller can merge the
 * result over a partly typed form without blanking what the user already wrote.
 */
export async function extractCard(
  images: CardImage[],
  options: { eventName?: string } = {},
): Promise<CardExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — see README.md step 3.");
  }
  if (images.length === 0) {
    throw new Error("No card images were supplied.");
  }

  const client = new Anthropic({ apiKey });

  const content: Anthropic.ContentBlockParam[] = [];
  images.forEach((image, index) => {
    content.push({
      type: "text",
      text: images.length > 1 ? `Image ${index + 1} of ${images.length}:` : "Card or badge:",
    });
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.base64 },
    });
  });
  content.push({
    type: "text",
    text: "Read it and call record_card_details with what you can see.",
  });

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: 1024,
    system: systemPrompt(options.eventName),
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
    messages: [{ role: "user", content }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === EXTRACT_TOOL.name,
  );
  if (!toolUse) return {};

  const raw = toolUse.input as Record<string, unknown>;
  const result: CardExtraction = {};
  for (const field of CARD_FIELDS) {
    const value = raw[field];
    if (typeof value === "string" && value.trim()) {
      result[field] = value.trim();
    }
  }
  return result;
}
