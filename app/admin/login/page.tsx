import type { Metadata } from "next";
import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · Aling Tinay Admin",
  // Keep the admin area out of search results.
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise and must be awaited.
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;

  // Only relative paths survive; the action re-validates this server-side too.
  const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/admin";

  return <LoginForm next={target} timedOut={reason === "timeout"} />;
}
