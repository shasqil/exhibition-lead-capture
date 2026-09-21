import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { App } from "@/components/app";
import { SetupChecklist, missingConfig } from "@/components/setup-checklist";

export const dynamic = "force-dynamic";

export default async function Home() {
  // A half-configured deployment is the most likely first experience, so say
  // exactly what is missing rather than throwing a 500 at whoever opens it.
  const missing = missingConfig();
  if (missing.length > 0) return <SetupChecklist missing={missing} />;

  const session = await readSession();
  if (!session) redirect("/login");

  return <App member={session.member} />;
}
