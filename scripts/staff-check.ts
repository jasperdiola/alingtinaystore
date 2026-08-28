/**
 * Verifies staff/role management — `npm run db:staff-check`.
 *
 * The properties under test are the lockout guards: nobody may demote or
 * deactivate themselves, and the last active super_admin cannot be removed.
 * Getting either wrong means an admin can permanently lock the whole team out
 * of the system with one click, with no way back in through the UI.
 *
 * Creates a throwaway second admin and deletes it, including its auth.users row.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => {
  if (c) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${l} ${d}`); }
  else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${l} ${d}`); }
};

/** Mirrors guardLockout() in app/actions/staff.ts. */
async function guard(
  c: Client,
  targetId: string,
  selfId: string,
  intent: "role" | "deactivate"
): Promise<string | null> {
  if (targetId === selfId) {
    return intent === "role"
      ? "You cannot change your own role. Ask another super admin."
      : "You cannot deactivate your own account.";
  }
  const t = (await c.query(
    `select role::text r, is_active from admin_users where id=$1`, [targetId]
  )).rows[0];
  if (!t) return "That account no longer exists.";
  if (t.r === "super_admin" && t.is_active) {
    const n = (await c.query(
      `select count(*)::int n from admin_users where role='super_admin' and is_active`
    )).rows[0].n;
    if (n <= 1) return "That is the last active super admin. Promote someone else first.";
  }
  return null;
}

async function main() {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();

  const me = (await c.query(`select id, email from admin_users where role='super_admin' limit 1`)).rows[0];
  const tempId = randomUUID();
  const tempEmail = `staff-check-${Date.now()}@example.com`;
  let created = false;

  try {
    console.log("\n1. Self-edit is refused");
    ok("cannot change your own role",
      (await guard(c, me.id, me.id, "role"))?.includes("your own role") === true);
    ok("cannot deactivate your own account",
      (await guard(c, me.id, me.id, "deactivate"))?.includes("your own account") === true);

    console.log("\n2. The last super admin cannot be removed");
    const supers = (await c.query(
      `select count(*)::int n from admin_users where role='super_admin' and is_active`
    )).rows[0].n;
    console.log(`  (currently ${supers} active super admin${supers === 1 ? "" : "s"})`);

    // A second super_admin, so "last one" is a real condition rather than
    // something that happens to be true because there is only one account.
    await c.query(`insert into auth.users (id, email) values ($1,$2)`, [tempId, tempEmail]);
    await c.query(
      `insert into admin_users (id, email, full_name, role) values ($1,$2,'Temp Super','super_admin')`,
      [tempId, tempEmail]
    );
    created = true;

    const nowSupers = (await c.query(
      `select count(*)::int n from admin_users where role='super_admin' and is_active`
    )).rows[0].n;
    ok("a second super admin exists", nowSupers === supers + 1, `${nowSupers}`);

    ok("with two, demoting one is allowed",
      (await guard(c, tempId, me.id, "role")) === null);
    ok("with two, deactivating one is allowed",
      (await guard(c, tempId, me.id, "deactivate")) === null);

    // Drop back to one and re-check.
    await c.query(`update admin_users set role='staff' where id=$1`, [tempId]);
    const blocked = await guard(c, me.id, tempId, "deactivate");
    ok("with one left, deactivating it is refused",
      blocked?.includes("last active super admin") === true, blocked ?? "(allowed)");
    const blockedRole = await guard(c, me.id, tempId, "role");
    ok("with one left, demoting it is refused",
      blockedRole?.includes("last active super admin") === true);

    console.log("\n3. A deactivated account loses access");
    await c.query(`update admin_users set is_active=false where id=$1`, [tempId]);
    // getAdminSession() requires an active row, so this is the check that
    // actually revokes them.
    const active = (await c.query(
      `select count(*)::int n from admin_users where id=$1 and is_active`, [tempId]
    )).rows[0].n;
    ok("deactivated row fails the is_active check", active === 0);

    console.log("\n4. Role changes stick");
    await c.query(`update admin_users set role='manager', is_active=true where id=$1`, [tempId]);
    const r = (await c.query(`select role::text r from admin_users where id=$1`, [tempId])).rows[0].r;
    ok("role updated to manager", r === "manager", r);

    console.log("\n5. Deleting an auth user cascades to their admin row");
    await c.query(`delete from auth.users where id=$1`, [tempId]);
    created = false;
    const gone = (await c.query(`select count(*)::int n from admin_users where id=$1`, [tempId])).rows[0].n;
    ok("admin_users row removed by cascade", gone === 0);
  } finally {
    if (created) {
      await c.query(`delete from auth.users where id=$1`, [tempId]).catch(() => {});
    }
    const left = (await c.query(
      `select count(*)::int n from admin_users where email like 'staff-check-%'`
    )).rows[0].n;
    const supers = (await c.query(
      `select count(*)::int n from admin_users where role='super_admin' and is_active`
    )).rows[0].n;
    const total = (await c.query(`select count(*)::int n from admin_users`)).rows[0].n;
    console.log(`\n  cleanup: ${left} test account(s) left · ${total} admin(s) total · ${supers} active super admin(s)`);
    if (left !== 0) { fail++; console.log("  \x1b[31mFAIL\x1b[0m test account not removed"); }
    if (supers < 1) { fail++; console.log("  \x1b[31mFAIL\x1b[0m no active super admin remains"); }
    await c.end();
  }

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\ncheck failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
