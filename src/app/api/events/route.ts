import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { ExhibitionEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toEvent(row: Record<string, unknown>): ExhibitionEvent {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    location: String(row.location ?? ""),
    starts_on: row.starts_on ? String(row.starts_on) : "",
    ends_on: row.ends_on ? String(row.ends_on) : "",
  };
}

export async function GET() {
  const { session, response } = await requireSession();
  if (!session) return response;

  try {
    const { data, error } = await supabase()
      .from("events")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ events: (data ?? []).map(toEvent) });
  } catch (error) {
    return errorResponse(error, "Could not load events.");
  }
}

export async function POST(request: Request) {
  const { session, response } = await requireSession();
  if (!session) return response;

  let body: { name?: unknown; location?: unknown; starts_on?: unknown; ends_on?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  if (!name) {
    return NextResponse.json({ error: "Give the exhibition a name." }, { status: 400 });
  }

  const asDate = (value: unknown) => {
    const text = typeof value === "string" ? value.trim() : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  };

  try {
    const { data, error } = await supabase()
      .from("events")
      .insert({
        name,
        location: typeof body.location === "string" ? body.location.trim().slice(0, 200) : "",
        starts_on: asDate(body.starts_on),
        ends_on: asDate(body.ends_on),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ event: toEvent(data) });
  } catch (error) {
    return errorResponse(error, "Could not create the event.");
  }
}
