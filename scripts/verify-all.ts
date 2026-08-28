/**
 * Runs every database verification suite — `npm run verify:db`.
 *
 * One entry point instead of thirteen, so CI and a developer run exactly the
 * same thing and neither can quietly skip a suite: the list below is derived
 * from package.json, so adding a `db:*-check` script enrols it automatically.
 *
 * Runs them SEQUENTIALLY on purpose. Every suite writes to the live database —
 * creating orders, moving stock, editing prices — and restores what it touched
 * at the end. Two suites running at once would interleave those writes and
 * report failures that are really just each other's edits.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

type Result = { name: string; ok: boolean; ms: number; summary: string };

/** Every `db:*-check` script, in package.json order. */
function suites(): string[] {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  return Object.keys(pkg.scripts).filter((s) => /^db:.*-check$/.test(s));
}

function run(script: string): Promise<Result> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("npm", ["run", "--silent", script], {
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));

    child.on("close", (code) => {
      // The suites all end with "N passed, M failed"; surface that line rather
      // than the whole transcript, and keep the transcript for failures.
      const tally = out.match(/(\d+) passed, (\d+) failed/g)?.at(-1) ?? "no tally";
      const ok = code === 0;
      if (!ok) {
        console.log(`\n\x1b[31m─── ${script} failed ───\x1b[0m`);
        console.log(out.trimEnd());
      }
      resolve({
        name: script,
        ok,
        ms: Date.now() - started,
        summary: tally.replace(/\x1b\[\d+m/g, ""),
      });
    });
  });
}

async function main() {
  const list = suites();
  if (list.length === 0) {
    console.error("no db:*-check scripts found in package.json");
    process.exitCode = 1;
    return;
  }

  console.log(`running ${list.length} verification suites\n`);
  const results: Result[] = [];
  for (const script of list) {
    process.stdout.write(`  ${script.padEnd(24)} `);
    const r = await run(script);
    results.push(r);
    const mark = r.ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    console.log(`${mark}  ${r.summary.padEnd(20)} ${(r.ms / 1000).toFixed(1)}s`);
  }

  const failed = results.filter((r) => !r.ok);
  const total = results.reduce((n, r) => n + r.ms, 0);
  console.log(
    `\n${failed.length === 0 ? "\x1b[32mall suites passed" : `\x1b[31m${failed.length} suite(s) failed: ${failed.map((f) => f.name).join(", ")}`}\x1b[0m` +
      `  ·  ${(total / 1000).toFixed(0)}s total\n`
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("verify failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
