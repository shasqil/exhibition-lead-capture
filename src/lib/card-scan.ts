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
    "Record the contact details printed on a business card. Call this exactly once, " +
    "after looking at every image provided.",
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

const SYSTEM_PROMPT = [
  "You read photographs of business cards and pull out the contact details.",
  "",
  "Rules:",
  "- The images may be the front and back of the same card. Treat them as one card and merge what you find.",
  "- Many cards print one side in English and the other in another language. Prefer the English spelling for names and companies; if only a non-Latin script is present, transliterate it and keep the original in the address field if it is an address.",
  "- Copy what is printed. Do not guess, complete, or correct an email address, phone number or URL.",
  "- Leave a field out entirely rather than filling it with a placeholder, 'N/A', or a guess.",
  "- A general company switchboard goes in 'phone'. A number labelled mobile, cell, hp, or M: goes in 'mobile'.",
  "- If an image is too blurred or dark to read, leave the affected fields out.",
].join("\n");

/**
 * Sends the card photos to Claude and returns whatever it could read.
 *
 * Returns only the fields that came back non-empty, so the caller can merge the
 * result over a partly typed form without blanking what the user already wrote.
 */
export async function extractCard(images: CardImage[]): Promise<CardExtraction> {
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
      text: images.length > 1 ? `Image ${index + 1} of ${images.length}:` : "Business card:",
    });
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.base64 },
    });
  });
  content.push({
    type: "text",
    text: "Read the card and call record_card_details with what you can see.",
  });

  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
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
