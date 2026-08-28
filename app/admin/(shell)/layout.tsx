import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/admin";
import { Sidebar, Topbar } from "./_components/nav";

/**
 * The real authorization boundary for the admin area.
 *
 * proxy.ts only checks that *a Supabase user* exists — it deliberately does no
 * database work, because it runs on every matched request including prefetches
 * (Next's own guidance). That leaves a gap: anyone who completes Supabase
 * sign-up has a session, and without this layout they would reach /admin
 * without an admin_users row.
 *
 * getAdminSession() closes it — it revalidates the JWT with Supabase and
 * requires an active admin_users row. React.cache means pages below can call
 * it again for free.
 */
export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login?next=/admin");

  return (
    <div className="flex min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      <a
        href="#admin-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm dark:focus:bg-neutral-900"
      >
        Skip to content
      </a>

      <Sidebar role={session.role} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          name={session.fullName || session.email}
          role={session.role}
          title="Admin"
        />
        <main id="admin-content" className="flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
