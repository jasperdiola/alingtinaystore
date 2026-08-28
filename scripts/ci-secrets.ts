/**
 * Lists the GitHub Actions secrets this pipeline needs — `npm run ci:secrets`.
 *
 * Reads the real values out of .env and prints them next to the secret name to
 * create at
 *   Settings -> Secrets and variables -> Actions -> New repository secret
 *
 * THIS PRINTS SECRETS TO YOUR TERMINAL. Do not run it on a shared screen, and
 * do not paste its output into an issue, a chat, or anywhere else.
 *
 * Pass --names to print only the names, which is safe to share.
 * Pass --push to upload them with the GitHub CLI instead of printing them —
 * values travel over stdin, so they never reach the screen or a process list.
 */
import { spawnSync } from "node:child_process";
import "dotenv/config";

type Secret = {
  name: string;
  why: string;
  /** Not in .env — obtained from Vercel, so it is prompted for rather than read. */
  external?: boolean;
  /** The app runs without it; its absence must not fail the setup. */
  optional?: boolean;
};

const REQUIRED: Secret[] = [
  // --- reaching the database from CI ---
  { name: "DATABASE_URL", why: "Prisma Client at runtime (transaction pooler, 6543)" },
  { name: "DIRECT_URL", why: "Prisma CLI and every verification suite (session pooler, 5432)" },
  { name: "NEXT_PUBLIC_SUPABASE_URL", why: "Supabase project URL" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", why: "Supabase auth for sign-in during render checks" },
  { name: "SESSION_SECRET", why: "Signs the admin idle cookie the render check must present" },
  { name: "ADMIN_SIGNUP_CODE", why: "Present so the build and staff suite behave as in production" },
  // Both degrade gracefully: without the service key an invitation is shared
  // as a link by hand, and without the site URL invite links fall back to the
  // request's own origin. Neither is set locally and every suite passes.
  { name: "SUPABASE_SERVICE_ROLE_KEY", why: "Sends invitation emails; without it, links are shared by hand", optional: true },
  { name: "NEXT_PUBLIC_SITE_URL", why: "Absolute links in invitation emails", optional: true },
  { name: "RENDER_CHECK_EMAIL", why: "Admin account the render check signs in as" },
  { name: "RENDER_CHECK_PASSWORD", why: "…and its password" },

  // --- deploying ---
  { name: "VERCEL_TOKEN", why: "Vercel -> Account Settings -> Tokens", external: true },
  { name: "VERCEL_ORG_ID", why: "`vercel link` then read .vercel/project.json", external: true },
  { name: "VERCEL_PROJECT_ID", why: "`vercel link` then read .vercel/project.json", external: true },
];

/**
 * Sets one secret through `gh`, passing the value on STDIN.
 *
 * Deliberately not `--body <value>`: command-line arguments are visible to
 * anything that can list processes, and land in shell history.
 */
function push(name: string, value: string, repo: string): boolean {
  const res = spawnSync("gh", ["secret", "set", name, "--repo", repo], {
    input: value,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (res.status === 0) return true;
  const why = (res.stderr || res.stdout || "gh failed").trim();
  console.log(`  \x1b[31mx\x1b[0m ${name.padEnd(30)} ${why}`);
  return false;
}

function pushAll(): void {
  const repo = process.env.CI_REPO ?? "jasperdiola/alingtinaystore";
  console.log(`\nsetting secrets on ${repo} (values sent over stdin)\n`);

  let set = 0;
  const absent: string[] = [];
  for (const s of REQUIRED) {
    const value = process.env[s.name];
    if (!value) {
      // An optional secret being absent is a note, not a blocker.
      if (!s.optional) absent.push(s.name);
      const mark = s.optional ? "\x1b[90m.\x1b[0m " : "\x1b[33m-\x1b[0m ";
      const where = s.optional
        ? `optional — ${s.why}`
        : s.external
          ? s.why
          : "not set in .env";
      console.log(`  ${mark}${s.name.padEnd(30)} ${where}`);
      continue;
    }
    if (push(s.name, value, repo)) {
      set++;
      // Length only — enough to spot a truncated paste, useless to a shoulder.
      console.log(`  \x1b[32mok\x1b[0m ${s.name.padEnd(30)} ${value.length} chars`);
    }
  }

  console.log(
    `\n${set} secret(s) set.` +
      (absent.length ? `  \x1b[33m${absent.length} still missing: ${absent.join(", ")}\x1b[0m` : "") +
      "\n"
  );
  process.exitCode = absent.length === 0 ? 0 : 1;
}

function main() {
  const namesOnly = process.argv.includes("--names");

  if (process.argv.includes("--push")) {
    pushAll();
    return;
  }

  if (namesOnly) {
    console.log("\nGitHub Actions secrets required by .github/workflows/ci.yml:\n");
    for (const s of REQUIRED) console.log(`  ${s.name.padEnd(30)} ${s.why}`);
    console.log("\nRun without --names to print the values from .env.\n");
    return;
  }

  console.log(
    "\n\x1b[33m! This prints real secrets. Make sure nobody is looking at your screen.\x1b[0m\n"
  );
  console.log("Add each at: Settings > Secrets and variables > Actions > New repository secret\n");

  const missing: string[] = [];
  for (const s of REQUIRED) {
    const value = process.env[s.name];
    if (!value) {
      missing.push(s.name);
      const where = s.external ? s.why : "not set in .env";
      console.log(`  \x1b[33m—\x1b[0m ${s.name}\n      ${where}\n`);
      continue;
    }
    console.log(`  \x1b[32m✓\x1b[0m ${s.name}\n      ${value}\n`);
  }

  if (missing.length) {
    console.log(
      `\x1b[33m${missing.length} still to obtain:\x1b[0m ${missing.join(", ")}\n` +
        "The three VERCEL_* values come from Vercel, not from .env — see README.\n"
    );
  } else {
    console.log("\x1b[32mAll secrets present.\x1b[0m\n");
  }

  console.log(
    "Reminder: these configure CI. The APP's runtime configuration lives in\n" +
      "Vercel's own environment variables, which `vercel pull` reads at deploy time.\n"
  );
}

main();
