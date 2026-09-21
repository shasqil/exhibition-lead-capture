import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { Session } from "./types";

export const SESSION_COOKIE = "elc_session";
const SESSION_DAYS = 30;

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or too short — set it to at least 32 random characters.",
    );
  }
  return new TextEncoder().encode(value);
}

/** The names that appear on the "who are you?" picker, from TEAM_MEMBERS. */
export function teamMembers(): string[] {
  return (process.env.TEAM_MEMBERS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Compares two strings without leaking, through timing, how much of the
 * passcode was correct.
 */
export function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  // Length differences are compared too, but only after the loop, so a wrong
  // length still costs the same time as a wrong character.
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export async function createSessionToken(session: Session): Promise<string> {
  return new SignJWT({ member: session.member })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function readSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const member = payload.member;
    if (typeof member !== "string" || !member) return null;
    return { member };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
