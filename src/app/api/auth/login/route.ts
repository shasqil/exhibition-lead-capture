import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  createSessionToken,
  safeEqual,
  sessionCookieOptions,
  teamMembers,
} from "@/lib/auth";

export const runtime = "nodejs";

/** Slows down someone working through passcodes from a script. */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export async function POST(request: Request) {
  const expected = process.env.TEAM_PASSCODE;
  if (!expected) {
    return NextResponse.json(
      { error: "TEAM_PASSCODE is not set — see README.md step 4." },
      { status: 500 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait ten minutes and try again." },
      { status: 429 },
    );
  }

  let body: { passcode?: unknown; member?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const passcode = typeof body.passcode === "string" ? body.passcode : "";
  const member = typeof body.member === "string" ? body.member.trim() : "";

  if (!safeEqual(passcode, expected)) {
    return NextResponse.json({ error: "That team code is not right." }, { status: 401 });
  }

  const roster = teamMembers();
  if (roster.length > 0 && !roster.includes(member)) {
    return NextResponse.json({ error: "Pick your name from the list." }, { status: 400 });
  }
  if (!member) {
    return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  }

  const token = await createSessionToken({ member });
  const response = NextResponse.json({ member });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
