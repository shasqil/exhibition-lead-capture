import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/api";
import { extractCard, isAllowedMediaType, type CardImage } from "@/lib/card-scan";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Two sides of one card, compressed — anything larger is a mistake. */
const MAX_IMAGES = 2;
const MAX_BASE64_CHARS = 7_000_000; // ~5 MB decoded, Anthropic's per-image ceiling.

export async function POST(request: Request) {
  const { session, response } = await requireSession();
  if (!session) return response;

  let body: { images?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (!Array.isArray(body.images) || body.images.length === 0) {
    return NextResponse.json({ error: "Take a photo of the card first." }, { status: 400 });
  }
  if (body.images.length > MAX_IMAGES) {
    return NextResponse.json({ error: "A card has at most two sides." }, { status: 400 });
  }

  const images: CardImage[] = [];
  for (const entry of body.images) {
    const item = entry as { base64?: unknown; media_type?: unknown };
    if (typeof item.base64 !== "string" || !item.base64) {
      return NextResponse.json({ error: "One of the photos was empty." }, { status: 400 });
    }
    if (item.base64.length > MAX_BASE64_CHARS) {
      return NextResponse.json({ error: "That photo is too large." }, { status: 413 });
    }
    const mediaType = typeof item.media_type === "string" ? item.media_type : "image/jpeg";
    if (!isAllowedMediaType(mediaType)) {
      return NextResponse.json(
        { error: "Photos must be JPEG, PNG, GIF or WebP." },
        { status: 400 },
      );
    }
    images.push({ base64: item.base64, mediaType });
  }

  try {
    const fields = await extractCard(images);
    return NextResponse.json({ fields });
  } catch (error) {
    return errorResponse(error, "Could not read the card. Type the details in instead.");
  }
}
