/**
 * Verifies product image upload — `npm run db:image-check`.
 *
 * The rules are cheap to assert; the part worth proving is that a real file
 * reaches Supabase Storage and comes back over the public URL. Everything else
 * about this feature could be correct and it would still be useless if the
 * bucket policy said no.
 *
 * So this signs in as a real admin, uploads a real PNG through the same
 * storage path the Server Action uses, fetches it back over HTTP, and checks
 * that an anonymous client is refused. Every object it creates is deleted.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import {
  ALLOWED_IMAGE_TYPES,
  checkImage,
  imagePath,
  isOwnUpload,
  MAX_IMAGE_BYTES,
  pathFromPublicUrl,
  PRODUCT_BUCKET,
} from "../lib/products/images";

let pass = 0,
  fail = 0;
const ok = (l: string, c: boolean, d = "") => {
  if (c) {
    pass++;
    console.log(`  \x1b[32mPASS\x1b[0m ${l} ${d}`);
  } else {
    fail++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${l} ${d}`);
  }
};

/** A real 1x1 PNG, so the bucket's MIME sniffing has something genuine. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const file = (name: string, type: string, bytes: Buffer | Uint8Array) =>
  new File([new Uint8Array(bytes)], name, { type });

async function main() {
  // Captured up front so cleanup can prove it left the bucket as it found it.
  const countPg = new Client({ connectionString: process.env.DIRECT_URL });
  await countPg.connect();
  const bucketBefore: number = (await countPg.query(
    `select count(*)::int n from storage.objects where bucket_id=$1`, [PRODUCT_BUCKET])).rows[0].n;
  await countPg.end();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  console.log("\n1. Validation rules (pure)");
  ok("a real PNG is accepted", checkImage(file("a.png", "image/png", PNG)) === null);
  ok("an empty file is refused", checkImage(file("a.png", "image/png", Buffer.alloc(0))) !== null);
  ok(
    "over 5MB is refused",
    checkImage(file("big.png", "image/png", Buffer.alloc(MAX_IMAGE_BYTES + 1))) !== null
  );
  ok(
    "a PDF is refused even when named .png",
    checkImage(file("sneaky.png", "application/pdf", PNG)) !== null
  );
  ok("every allowed type passes", ALLOWED_IMAGE_TYPES.every((t) => checkImage(file("x", t, PNG)) === null));

  console.log("\n2. Path helpers round-trip");
  const p = imagePath("abc-123", file("a.png", "image/png", PNG));
  ok("path is namespaced by product id", p.startsWith("abc-123/"), p);
  ok("extension follows the MIME type, not the filename", p.endsWith(".png"));
  ok(
    "webp maps to .webp",
    imagePath("x", file("a.jpg", "image/webp", PNG)).endsWith(".webp")
  );
  const publicUrl = `${url}/storage/v1/object/public/${PRODUCT_BUCKET}/${p}`;
  ok("our own uploads are recognised", isOwnUpload(publicUrl));
  ok("an external URL is not ours", !isOwnUpload("https://placehold.co/600x600"));
  ok("a local path is not ours", !isOwnUpload("/images/Adobong Mani.jpeg"));
  ok("the path is recovered from the URL", pathFromPublicUrl(publicUrl) === p, pathFromPublicUrl(publicUrl) ?? "null");

  console.log("\n3. An anonymous client cannot upload");
  const anon = createClient(url, anonKey);
  const anonRes = await anon.storage
    .from(PRODUCT_BUCKET)
    .upload(`anon-probe/${Date.now()}.png`, file("a.png", "image/png", PNG), {
      contentType: "image/png",
    });
  ok("refused without a session", anonRes.error !== null, anonRes.error?.message ?? "IT SUCCEEDED");

  console.log("\n4. A signed-in manager can upload, and the public URL serves it");
  const admin = createClient(url, anonKey);
  const { error: authErr } = await admin.auth.signInWithPassword({
    email: process.env.RENDER_CHECK_EMAIL!,
    password: process.env.RENDER_CHECK_PASSWORD!,
  });
  if (authErr) throw new Error(`sign-in failed: ${authErr.message}`);

  const probePath = `image-check/${Date.now()}.png`;
  let uploaded = false;
  try {
    const { error: upErr } = await admin.storage
      .from(PRODUCT_BUCKET)
      .upload(probePath, file("probe.png", "image/png", PNG), { contentType: "image/png" });
    ok("upload accepted", upErr === null, upErr?.message ?? "");
    uploaded = upErr === null;

    if (uploaded) {
      const { data } = admin.storage.from(PRODUCT_BUCKET).getPublicUrl(probePath);
      const res = await fetch(data.publicUrl);
      ok("public URL responds 200", res.status === 200, `HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      ok("the bytes served match the bytes uploaded", bytes.equals(PNG), `${bytes.length}B`);
      ok(
        "served as an image",
        (res.headers.get("content-type") ?? "").startsWith("image/"),
        res.headers.get("content-type") ?? "none"
      );
      ok("that URL is recognised as ours", isOwnUpload(data.publicUrl));
      ok("and its path round-trips", pathFromPublicUrl(data.publicUrl) === probePath);
    }

    console.log("\n5. The bucket enforces its own limits");
    // Not merely a client-side rule: the type list lives on the bucket, so a
    // caller bypassing checkImage still cannot store a PDF.
    const badType = await admin.storage
      .from(PRODUCT_BUCKET)
      .upload(`image-check/bad-${Date.now()}.pdf`, file("x.pdf", "application/pdf", PNG), {
        contentType: "application/pdf",
      });
    ok("bucket refuses a disallowed MIME type", badType.error !== null,
      badType.error?.message ?? "IT SUCCEEDED");
    if (!badType.error && badType.data?.path) {
      await admin.storage.from(PRODUCT_BUCKET).remove([badType.data.path]);
    }
  } finally {
    console.log("\ncleanup");
    if (uploaded) {
      const { error } = await admin.storage.from(PRODUCT_BUCKET).remove([probePath]);
      ok("probe object deleted", error === null, error?.message ?? "");

      /*
       * Checked against storage.objects, NOT by re-fetching the public URL.
       *
       * Public buckets are served through a CDN, so a deleted object can still
       * be returned from cache for a while — the earlier version of this
       * assertion passed or failed depending on whether the edge happened to
       * have the object cached, which is a flaky test rather than a real one.
       * The row is the authoritative record of what exists.
       *
       * That cache is also why imagePath() timestamps every upload: replacing
       * an image writes a NEW url, so a customer can never be served the
       * previous picture from a cached copy of the old one.
       */
      const pg = new Client({ connectionString: process.env.DIRECT_URL });
      await pg.connect();
      const left = (
        await pg.query(
          `select count(*)::int n from storage.objects where bucket_id=$1 and name=$2`,
          [PRODUCT_BUCKET, probePath]
        )
      ).rows[0].n;
      const total = (
        await pg.query(`select count(*)::int n from storage.objects where bucket_id=$1`, [
          PRODUCT_BUCKET,
        ])
      ).rows[0].n;
      await pg.end();
      ok("the object row is gone", left === 0);
      ok("the bucket has no leftovers from this run", total === bucketBefore,
        `${total} objects, started at ${bucketBefore}`);
    }
    await admin.auth.signOut();
  }

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\ncheck failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
