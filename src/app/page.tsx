import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { App } from "@/components/app";
import { SetupChecklist, missingConfig } from "@/components/setup-checklist";

export const dynamic = "force-dynamic";

/**
 * The tickable products on the capture form, from PRODUCTS. Kept server-side
 * and passed down so the list can be changed in Vercel without a code change,
 * and without shipping a NEXT_PUBLIC_ variable.
 */
function productList(): string[] {
  const configured = (process.env.PRODUCTS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : ["Armourflex", "Androflex", "Audioflex"];
}

export default async function Home() {
  // A half-configured deployment is the most likely first experience, so say
  // exactly what is missing rather than throwing a 500 at whoever opens it.
  const missing = missingConfig();
  if (missing.length > 0) return <SetupChecklist missing={missing} />;

  const session = await readSession();
  if (!session) redirect("/login");

  return <App member={session.member} products={productList()} />;
}
