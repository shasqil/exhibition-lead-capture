import { NextResponse } from "next/server";
import { readSession } from "./auth";
import type { Session } from "./types";

/** Every API route below /api (except login) goes through this. */
export async function requireSession(): Promise<
  { session: Session; response?: never } | { session?: never; response: NextResponse }
> {
  const session = await readSession();
  if (!session) {
    return { response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  return { session };
}

/**
 * Turns a thrown error into a response.
 *
 * Configuration mistakes (a missing key) are the most likely failure when the
 * app is first set up, so their message is passed through to save the person
 * deploying it a trip to the logs. Everything else stays generic.
 */
export function errorResponse(error: unknown, fallback: string): NextResponse {
  const message = error instanceof Error ? error.message : "";
  const isConfigProblem = /is (?:not set|missing)|must be set/i.test(message);
  console.error(fallback, error);
  return NextResponse.json(
    { error: isConfigProblem ? message : fallback },
    { status: isConfigProblem ? 500 : 502 },
  );
}
