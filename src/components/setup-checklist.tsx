interface Requirement {
  key: string;
  what: string;
  where: string;
}

const REQUIRED: Requirement[] = [
  {
    key: "SESSION_SECRET",
    what: "Signs the sign-in cookie.",
    where: "Any 32+ random characters. Run: openssl rand -base64 32",
  },
  {
    key: "TEAM_PASSCODE",
    what: "The shared code your team types to get in.",
    where: "Pick something your team can remember but outsiders will not guess.",
  },
  {
    key: "SUPABASE_URL",
    what: "Where the leads are stored.",
    where: "Supabase dashboard → Project Settings → Data API → Project URL",
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    what: "Lets the app read and write that storage.",
    where: "Supabase dashboard → Project Settings → API keys → service_role",
  },
  {
    key: "ANTHROPIC_API_KEY",
    what: "Reads the business card photos.",
    where: "console.anthropic.com → API keys",
  },
];

export function missingConfig(): Requirement[] {
  return REQUIRED.filter((item) => {
    const value = process.env[item.key];
    if (!value) return true;
    if (item.key === "SESSION_SECRET" && value.length < 32) return true;
    return false;
  });
}

export function SetupChecklist({ missing }: { missing: Requirement[] }) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Almost there</h1>
        <p className="mt-1 text-sm text-slate-600">
          {missing.length} environment variable{missing.length === 1 ? "" : "s"}{" "}
          {missing.length === 1 ? "is" : "are"} missing. Add{" "}
          {missing.length === 1 ? "it" : "them"} in Vercel under{" "}
          <strong>Settings → Environment Variables</strong>, then redeploy.
        </p>

        <ul className="mt-5 space-y-3">
          {missing.map((item) => (
            <li key={item.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <code className="text-sm font-bold text-slate-900">{item.key}</code>
              <p className="mt-0.5 text-sm text-slate-600">{item.what}</p>
              <p className="mt-1 text-xs text-slate-500">{item.where}</p>
            </li>
          ))}
        </ul>

        <p className="mt-5 text-xs text-slate-400">
          Full instructions are in README.md in the repository.
        </p>
      </div>
    </main>
  );
}
