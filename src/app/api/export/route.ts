import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/lib/api";
import { rowToLead } from "@/lib/normalise";
import { supabase } from "@/lib/supabase";
import { RATINGS, RATING_LABELS, type Lead, type Rating } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Column {
  header: string;
  width: number;
  value: (lead: Lead) => string;
}

/** The sheet layout. Order here is the order in the spreadsheet. */
const COLUMNS: Column[] = [
  { header: "Exhibition", width: 24, value: (l) => l.event_name ?? "" },
  { header: "Rating", width: 12, value: (l) => RATING_LABELS[l.rating] },
  { header: "Name", width: 24, value: (l) => l.full_name },
  { header: "Job title", width: 24, value: (l) => l.job_title },
  { header: "Company", width: 28, value: (l) => l.company },
  { header: "Email", width: 30, value: (l) => l.email },
  { header: "Mobile", width: 20, value: (l) => l.mobile },
  { header: "Phone", width: 20, value: (l) => l.phone },
  { header: "Website", width: 26, value: (l) => l.website },
  { header: "Address", width: 34, value: (l) => l.address },
  { header: "Country", width: 16, value: (l) => l.country },
  { header: "Products discussed", width: 30, value: (l) => l.products_discussed },
  { header: "What we talked about", width: 48, value: (l) => l.notes },
  { header: "Follow-up action", width: 32, value: (l) => l.follow_up },
  { header: "Captured by", width: 16, value: (l) => l.captured_by },
  // Split so a pivot can group by day or by hour without parsing anything.
  { header: "Captured date", width: 14, value: (l) => capturedDate(l.captured_at) },
  { header: "Captured time", width: 14, value: (l) => capturedTime(l.captured_at) },
  { header: "Card front", width: 14, value: (l) => l.card_front_url ?? "" },
  { header: "Card back", width: 14, value: (l) => l.card_back_url ?? "" },
];

/** 1-based column number for a header, so the styling below cannot drift. */
function columnAt(header: string): number {
  const index = COLUMNS.findIndex((column) => column.header === header);
  if (index === -1) throw new Error(`Unknown export column: ${header}`);
  return index + 1;
}

const HEADER_FILL = "FF1E293B";
const RATING_FILL: Record<Rating, string> = {
  hot: "FFFEE2E2",
  warm: "FFFEF3C7",
  cold: "FFE0F2FE",
  not_a_lead: "FFF1F5F9",
};

/**
 * Timestamps are stored in UTC, but a booth happens in one place and the
 * spreadsheet is read by people who were standing in it. Rendering in the
 * exhibition's own timezone is the difference between "09:14, just after the
 * doors opened" and a baffling "01:14".
 */
const TIMEZONE = process.env.TIMEZONE || "Asia/Singapore";

function parts(iso: string): Record<string, string> | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
}

/** ISO-ordered, so it still sorts correctly as text in Excel. */
function capturedDate(iso: string): string {
  const p = parts(iso);
  return p ? `${p.year}-${p.month}-${p.day}` : "";
}

function capturedTime(iso: string): string {
  const p = parts(iso);
  // Intl renders midnight as "24" in some locales; normalise it.
  return p ? `${p.hour === "24" ? "00" : p.hour}:${p.minute}` : "";
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
  return cleaned.slice(0, 60) || "leads";
}

export async function GET(request: Request) {
  const { session, response } = await requireSession();
  if (!session) return response;

  const params = new URL(request.url).searchParams;
  const eventId = params.get("event");
  const includeNonLeads = params.get("include_non_leads") === "1";

  try {
    let query = supabase()
      .from("leads")
      .select("*")
      .eq("deleted", false)
      .order("captured_at", { ascending: true });
    if (eventId) query = query.eq("event_id", eventId);
    if (!includeNonLeads) query = query.neq("rating", "not_a_lead");

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const leads = (data ?? []).map(rowToLead);
    const eventName = eventId ? (leads[0]?.event_name ?? "") : "";

    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();

    buildLeadsSheet(workbook, leads);
    buildSummarySheet(workbook, leads);

    // exceljs types this as ArrayBuffer but hands back a Node Buffer at
    // runtime. The Uint8Array constructor copes with either — it views an
    // ArrayBuffer and copies a Buffer — so this is correct both ways.
    const written = await workbook.xlsx.writeBuffer();
    const body = new Uint8Array(written as ArrayBuffer);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${safeFilename(eventName || "exhibition-leads")}-${stamp}.xlsx`;

    return new NextResponse(body, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, "Could not build the spreadsheet.");
  }
}

function buildLeadsSheet(workbook: ExcelJS.Workbook, leads: Lead[]) {
  const sheet = workbook.addWorksheet("Leads", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = COLUMNS.map((column) => ({ header: column.header, width: column.width }));

  const header = sheet.getRow(1);
  header.height = 22;
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: "middle" };

  for (const lead of leads) {
    const row = sheet.addRow(COLUMNS.map((column) => column.value(lead)));
    row.alignment = { vertical: "top", wrapText: true };

    // Tint the rating cell so hot leads jump out when you scroll.
    const ratingCell = row.getCell(columnAt("Rating"));
    ratingCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: RATING_FILL[lead.rating] },
    };
    ratingCell.font = { bold: lead.rating === "hot" };
    ratingCell.alignment = { vertical: "top", horizontal: "center" };

    linkCell(
      row.getCell(columnAt("Email")),
      lead.email ? `mailto:${lead.email}` : null,
      lead.email,
    );
    linkCell(row.getCell(columnAt("Card front")), lead.card_front_url, "Photo");
    linkCell(row.getCell(columnAt("Card back")), lead.card_back_url, "Photo");
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };
}

function linkCell(cell: ExcelJS.Cell, target: string | null, text: string) {
  if (!target || !text) return;
  cell.value = { text, hyperlink: target };
  cell.font = { color: { argb: "FF2563EB" }, underline: true };
}

/** A one-glance tally so the post-show debrief does not start with a pivot table. */
function buildSummarySheet(workbook: ExcelJS.Workbook, leads: Lead[]) {
  const sheet = workbook.addWorksheet("Summary");
  sheet.columns = [
    { header: "", width: 26 },
    ...RATINGS.map((rating) => ({ header: RATING_LABELS[rating], width: 13 })),
    { header: "Total", width: 10 },
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };

  const byPerson = new Map<string, Record<Rating, number>>();
  const blank = (): Record<Rating, number> => ({ hot: 0, warm: 0, cold: 0, not_a_lead: 0 });

  for (const lead of leads) {
    const person = lead.captured_by || "Unattributed";
    const tally = byPerson.get(person) ?? blank();
    tally[lead.rating] += 1;
    byPerson.set(person, tally);
  }

  const people = [...byPerson.keys()].sort((a, b) => a.localeCompare(b));
  for (const person of people) {
    const tally = byPerson.get(person)!;
    const counts = RATINGS.map((rating) => tally[rating]);
    sheet.addRow([person, ...counts, counts.reduce((sum, n) => sum + n, 0)]);
  }

  const totals = RATINGS.map((rating) => leads.filter((lead) => lead.rating === rating).length);
  const totalRow = sheet.addRow(["All leads", ...totals, leads.length]);
  totalRow.font = { bold: true };
  totalRow.border = { top: { style: "thin" } };

  // Only worth the rows when the file actually spans more than one show —
  // exporting a single exhibition would just repeat the totals above.
  const byShow = new Map<string, Record<Rating, number>>();
  for (const lead of leads) {
    const show = lead.event_name?.trim() || "No exhibition";
    const tally = byShow.get(show) ?? blank();
    tally[lead.rating] += 1;
    byShow.set(show, tally);
  }
  if (byShow.size > 1) {
    sheet.addRow([]);
    const heading = sheet.addRow(["By exhibition", ...RATINGS.map(() => ""), ""]);
    heading.font = { bold: true, color: { argb: "FFFFFFFF" } };
    heading.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };

    for (const show of [...byShow.keys()].sort((a, b) => a.localeCompare(b))) {
      const tally = byShow.get(show)!;
      const counts = RATINGS.map((rating) => tally[rating]);
      sheet.addRow([show, ...counts, counts.reduce((sum, n) => sum + n, 0)]);
    }
  }
}
