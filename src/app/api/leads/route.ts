import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/api";
import { leadToRow, normaliseLead, rowToLead } from "@/lib/normalise";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One phone's offline backlog after a long show; more than this is a bug. */
const MAX_BATCH = 200;

/**
 * Everything the team has captured.
 *
 * `?since=<iso>` narrows it to what changed after that moment, which is what
 * the sync engine uses on every pass after the first. Deleted rows are included
 * so a removal made on one phone reaches the others.
 */
export async function GET(request: Request) {
  const { session, response } = await requireSession();
  if (!session) return response;

  const since = new URL(request.url).searchParams.get("since");
  const now = new Date().toISOString();

  try {
    let query = supabase().from("leads").select("*").order("updated_at", { ascending: true });
    if (since && !Number.isNaN(Date.parse(since))) {
      query = query.gt("updated_at", new Date(since).toISOString());
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json({
      leads: (data ?? []).map(rowToLead),
      now,
    });
  } catch (error) {
    return errorResponse(error, "Could not load leads.");
  }
}

/** Takes a batch of leads from a phone and folds them into the table. */
export async function POST(request: Request) {
  const { session, response } = await requireSession();
  if (!session) return response;

  let body: { leads?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (!Array.isArray(body.leads)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (body.leads.length > MAX_BATCH) {
    return NextResponse.json({ error: "Too many leads in one go." }, { status: 413 });
  }

  const rows = body.leads
    .map((lead) => normaliseLead(lead, session.member))
    .filter((lead): lead is NonNullable<typeof lead> => lead !== null)
    .map(leadToRow);

  if (rows.length === 0) {
    return NextResponse.json({ saved: 0 });
  }

  try {
    const { error } = await supabase().rpc("upsert_leads", { payload: rows });
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: rows.length });
  } catch (error) {
    return errorResponse(error, "Could not save leads.");
  }
}
