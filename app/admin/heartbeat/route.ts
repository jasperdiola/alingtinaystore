export const dynamic = "force-dynamic";

/**
 * Does nothing on purpose.
 *
 * Its only job is to be a cheap request under /admin, so the proxy re-stamps
 * the idle cookie. That's how typing in a long form — which makes no requests
 * of its own — still counts as activity.
 *
 * If the session has already timed out the proxy redirects instead, so the
 * client sees something other than 204 and knows it has been signed out.
 */
export async function GET() {
  return new Response(null, { status: 204 });
}
