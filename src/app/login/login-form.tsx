"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button, Field, Spinner } from "@/components/ui";

export default function LoginForm({ members }: { members: string[] }) {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [member, setMember] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode, member }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not sign in.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("No connection. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  const ready = passcode.trim().length > 0 && member.trim().length > 0;

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <header className="space-y-1 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-xl">
            🪪
          </div>
          <h1 className="text-xl font-bold text-slate-900">Lead Capture</h1>
          <p className="text-sm text-slate-500">Sign in to start scanning cards.</p>
        </header>

        {error ? <Banner tone="error">{error}</Banner> : null}

        {members.length > 0 ? (
          <div>
            <span className="mb-2 block text-sm font-medium text-slate-700">Who are you?</span>
            <div className="grid grid-cols-2 gap-2">
              {members.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setMember(name)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${
                    member === name
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <Field
            label="Your name"
            value={member}
            onChange={setMember}
            placeholder="e.g. Shas"
            autoComplete="name"
            hint="Set TEAM_MEMBERS to get a picker"
          />
        )}

        <Field
          label="Team code"
          value={passcode}
          onChange={setPasscode}
          type="password"
          placeholder="Shared code from your admin"
          autoComplete="current-password"
        />

        <Button type="submit" full disabled={!ready || busy}>
          {busy ? <Spinner /> : null}
          {busy ? "Signing in…" : "Sign in"}
        </Button>

        <p className="text-center text-xs text-slate-400">
          You stay signed in on this phone for 30 days.
        </p>
      </form>
    </main>
  );
}
