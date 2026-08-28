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
 */
import "dotenv/config";

type Secret = {
  name: string;
  why: string;
  /** Not in .env — obtained from Vercel, so it is prompted for rather than read. */
  external?: boolean;
};

const REQUIRED: Secret[] = [
  // --- reaching the database from CI ---
  { name: "DATABASE_URL", why: "Prisma Client at runtime (transaction pooler, 6543)" },
  { name: "DIRECT_URL", why: "Prisma CLI and every verification suite (session pooler, 5432)" },
  { name: "NEXT_PUBLIC_SUPABASE_URL", why: "Supabase project URL" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", why: "Supabase auth for sign-in during render checks" },
  { name: "SESSION_SECRET", why: "Signs the admin idle cookie the render check must present" },
  { name: "ADMIN_SIGNUP_CODE", why: "Present so the build and staff suite behave as in production" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", why: "Optional today; kept so CI matches production" },
  { name: "NEXT_PUBLIC_SITE_URL", why: "Absolute links in invitation emails" },
  { name: "RENDER_CHECK_EMAIL", why: "Admin account the render check signs in as" },
  { name: "RENDER_CHECK_PASSWORD", why: "…and its password" },

  // --- deploying ---
  { name: "VERCEL_TOKEN", why: "Vercel -> Account Settings -> Tokens", external: true },
  { name: "VERCEL_ORG_ID", why: "`vercel link` then read .vercel/project.json", external: true },
  { name: "VERCEL_PROJECT_ID", why: "`vercel link` then read .vercel/project.json", external: true },
];

function main() {
  const namesOnly = process.argv.includes("--names");

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
