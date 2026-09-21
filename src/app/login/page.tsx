import { redirect } from "next/navigation";
import { readSession, teamMembers } from "@/lib/auth";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await readSession()) redirect("/");
  return <LoginForm members={teamMembers()} />;
}
