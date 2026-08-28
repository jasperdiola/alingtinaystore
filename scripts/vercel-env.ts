/**
 * Pushes the app's runtime configuration to Vercel — `npm run vercel:env`.
 *
 * This is a different set from the GitHub secrets, and confusing the two is the
 * usual reason a green pipeline deploys a site that cannot reach its database:
 *
 *   GitHub secrets  let the PIPELINE run — reach the database from a runner,
 *                   and authenticate to Vercel in order to deploy.
 *   Vercel env vars let the DEPLOYED APP run. `vercel pull` reads them at build
 *                   time; nothing in GitHub is visible to the running site.
 *
 * Values come from .env and are piped over stdin, never passed as arguments.
 *
 * Re-runnable: an existing variable is removed and re-added, because
 * `vercel env add` refuses to overwrite.
 */
import { spawnSync } from "node:child_process";
import "dotenv/config";

/**
 * Everything the running application reads. Test-only keys are not here.
 *
 * `type` is set explicitly rather than left to Vercel's guess. NEXT_PUBLIC_*
 * values are compiled into the browser bundle and are public by definition, so
 * storing them as config keeps them readable in the dashboard; everything else
 * is a secret. Leaving it unset makes the CLI *ask*, and an interactive prompt
 * in a piped script reads the next value as its answer — which is exactly how
 * an earlier run put the anon key into NEXT_PUBLIC_SUPABASE_URL.
 */
const RUNTIME = [
  { name: "DATABASE_URL", why: "Prisma Client (transaction pooler)", type: "secret" },
  { name: "DIRECT_URL", why: "Prisma CLI during the build", type: "secret" },
  { name: "NEXT_PUBLIC_SUPABASE_URL", why: "Supabase project", type: "config" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", why: "Admin sign-in", type: "config" },
  { name: "SESSION_SECRET", why: "Signs the admin idle cookie", type: "secret" },
  { name: "ADMIN_SIGNUP_CODE", why: "Gate on /admin/signup", type: "secret" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", why: "Invitation emails", type: "secret", optional: true },
  { name: "NEXT_PUBLIC_SITE_URL", why: "Absolute links in invite emails", type: "config", optional: true },
];

const ENVIRONMENTS = ["production", "preview", "development"] as const;

function vercel(args: string[], input?: string) {
  return spawnSync("npx", ["--yes", "vercel@latest", ...args], {
    input,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

function main() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    console.error("\nVERCEL_TOKEN is not set in .env.\n");
    process.exitCode = 1;
    return;
  }

  // Only production by default: preview and development deployments would
  // otherwise write to the live database from every branch.
  const targets = process.argv.includes("--all")
    ? ENVIRONMENTS
    : (["production"] as const);

  console.log(`\nsetting Vercel env for: ${targets.join(", ")}\n`);

  let set = 0;
  const skipped: string[] = [];

  for (const v of RUNTIME) {
    const value = process.env[v.name];
    if (!value) {
      if (!v.optional) skipped.push(v.name);
      const mark = v.optional ? "\x1b[90m.\x1b[0m " : "\x1b[33m-\x1b[0m ";
      console.log(`  ${mark}${v.name.padEnd(30)} not in .env${v.optional ? " (optional)" : ""}`);
      continue;
    }

    let wrote = 0;
    for (const target of targets) {
      // --force overwrites in place, so there is no remove-then-add window
      // where the variable is missing. --yes and an explicit --type mean the
      // CLI never prompts, which is what kept the piped values aligned.
      const res = vercel(
        [
          "env",
          "add",
          v.name,
          target,
          "--force",
          "--yes",
          `--type=${v.type}`,
          `--token=${token}`,
        ],
        value
      );
      if (res.status !== 0) {
        const why = (res.stderr || res.stdout || "failed").trim().split("\n").pop();
        console.log(`  \x1b[31mx\x1b[0m ${v.name.padEnd(30)} ${target}: ${why}`);
        continue;
      }
      wrote++;
      set++;
    }
    // Reported per variable, and only when every target actually took it —
    // an earlier version printed "ok" even after a failure.
    if (wrote === targets.length) {
      console.log(`  \x1b[32mok\x1b[0m ${v.name.padEnd(30)} ${value.length} chars · ${v.why}`);
    } else {
      skipped.push(v.name);
    }
  }

  console.log(
    `\n${set} value(s) written.` +
      (skipped.length ? `  \x1b[33mmissing: ${skipped.join(", ")}\x1b[0m` : "") +
      "\n"
  );
  process.exitCode = skipped.length === 0 ? 0 : 1;
}

main();
