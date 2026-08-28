/**
 * Attaches payment QR images — `npm run db:set-qr`.
 *
 * Finds `Gcash.*` and `Bank.*` in public/images and points
 * payment_methods.qr_image_path at them.
 *
 * A local /images/... path rather than a storage upload, because that is
 * already how this project stores product pictures — products.image holds
 * "/images/Adobong Mani.jpeg". Following the same convention means one place to
 * put an image and one way to reference it. (The public payment-qr bucket
 * remains the better home once QRs need swapping without a redeploy; this is
 * the short path to getting them on screen.)
 *
 * Safe to re-run, and it reports rather than fails when an image is not there
 * yet — the point is to be run again once it is.
 */
import "dotenv/config";
import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { Client } from "pg";

const SOURCE_DIR = join(process.cwd(), "public", "images");

/** Which file name belongs to which payment method type. */
const WANTED = [
  { base: "gcash", type: "gcash_qr", label: "GCash" },
  { base: "bank", type: "bank_transfer", label: "Bank Transfer" },
];

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

/** Case-insensitive, so Gcash.png / gcash.PNG / GCash.jpg all match. */
function findImage(base: string): string | null {
  if (!existsSync(SOURCE_DIR)) return null;
  const hit = readdirSync(SOURCE_DIR).find((name) => {
    const ext = extname(name).toLowerCase();
    return IMAGE_EXT.has(ext) && name.slice(0, name.length - ext.length).toLowerCase() === base;
  });
  return hit ?? null;
}

async function main() {
  const pg = new Client({ connectionString: process.env.DIRECT_URL });
  await pg.connect();

  let attached = 0;
  let missing = 0;

  for (const { base, type, label } of WANTED) {
    const method = (
      await pg.query(
        `select id, name from payment_methods where type = $1::payment_method_type`,
        [type]
      )
    ).rows[0];
    if (!method) {
      console.log(`  \x1b[31mskip\x1b[0m  no payment method of type ${type}`);
      continue;
    }

    const file = findImage(base);
    if (!file) {
      missing++;
      console.log(
        `  \x1b[33mwait\x1b[0m  ${label}: no "${base}.(jpg|jpeg|png|webp|avif)" in public/images`
      );
      continue;
    }

    // Encoded, because these filenames routinely contain spaces.
    const url = `/images/${encodeURIComponent(file)}`;
    await pg.query(
      `update payment_methods set qr_image_path = $2, updated_at = now() where id = $1`,
      [method.id, url]
    );
    attached++;
    const kb = Math.round(statSync(join(SOURCE_DIR, file)).size / 1024);
    console.log(`  \x1b[32mok\x1b[0m    ${label} -> ${url}  (${kb}KB)`);
  }

  console.log("\ncurrent payment methods:");
  console.table(
    (
      await pg.query(
        `select name, type::text as type, is_active, coalesce(qr_image_path, '-') as qr
           from payment_methods order by display_order`
      )
    ).rows
  );
  await pg.end();

  if (missing > 0) {
    console.log(`\n${missing} image(s) not found. Put them in public/images and run this again.\n`);
  } else if (attached > 0) {
    console.log(`\n${attached} QR image(s) attached.\n`);
  }
  process.exitCode = 0;
}

main().catch((e) => {
  console.error("\nfailed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
