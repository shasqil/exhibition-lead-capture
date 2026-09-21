import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/api";
import { CARD_BUCKET, supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const { session, response } = await requireSession();
  if (!session) return response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const file = form.get("file");
  const leadId = form.get("lead_id");
  const side = form.get("side");

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No photo was attached." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That photo is too large." }, { status: 413 });
  }
  // The id becomes a storage path, so it must not be attacker-shaped.
  if (typeof leadId !== "string" || !UUID.test(leadId)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (side !== "front" && side !== "back") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const contentType = file.type || "image/jpeg";
  const extension = contentType === "image/png" ? "png" : "jpg";
  const path = `${leadId}/${side}.${extension}`;

  try {
    const client = supabase();
    const { error } = await client.storage
      .from(CARD_BUCKET)
      .upload(path, await file.arrayBuffer(), { contentType, upsert: true });
    if (error) throw new Error(error.message);

    const { data } = client.storage.from(CARD_BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl });
  } catch (error) {
    return errorResponse(error, "Could not upload the photo.");
  }
}
