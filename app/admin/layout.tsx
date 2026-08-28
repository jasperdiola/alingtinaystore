import IdleWatcher from "./_components/idle-watcher";

/**
 * Pass-through layout. It exists only to mount the idle watcher on every
 * admin route; it deliberately adds no chrome so app/admin/page.tsx renders
 * exactly as it did before.
 *
 * IdleWatcher no-ops on /admin/login and /admin/signup.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <IdleWatcher />
    </>
  );
}
