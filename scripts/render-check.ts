/**
 * Renders the admin site and checks what actually reaches the browser —
 * `npm run check:render`.
 *
 * Why this exists
 * ---------------
 * The Adjust button in Inventory was dead for a while and nothing caught it.
 * `tsc`, `eslint` and `next build` all passed, the page rendered, and the
 * database suites were green — because the fault was neither in the types nor
 * in the SQL. `REASONS` was exported from a "use server" module, so the
 * bundler rewrote it into a server-action reference; `REASONS.map()` then threw
 * in the browser and only in the browser. Server-side rendering resolves the
 * real module, so even the HTML looked right.
 *
 * That class of bug is invisible to every check that does not look at the
 * shipped client JavaScript. So this suite does three things no other suite
 * does:
 *
 *   1. refuses a "use server" module that exports anything but async functions
 *      — the root cause, caught statically and instantly;
 *   2. renders every admin route against a real signed-in session and asserts
 *      the page came back whole;
 *   3. downloads the client chunks each page references and asserts the
 *      interactive panels' own strings are in them. A panel behind a click
 *      never appears in the HTML, but its code must still be in the bundle.
 *
 * Read-only: it signs in, fetches pages and reads bundles. Nothing is written.
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { Client } from "pg";
import { IDLE_COOKIE, stampValue } from "../lib/auth/idle";
import { REASONS } from "../lib/inventory/reasons";

const PORT = Number(process.env.RENDER_CHECK_PORT ?? 4123);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BOOT_TIMEOUT_MS = 90_000;

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

/* ------------------------------------------------ 1. static: "use server" */

/** The file's leading directive, ignoring the licence/doc comments above it. */
function leadingDirective(src: string): string | null {
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) {
      i++;
      continue;
    }
    if (src.startsWith("//", i)) {
      const n = src.indexOf("\n", i);
      i = n < 0 ? src.length : n + 1;
      continue;
    }
    if (src.startsWith("/*", i)) {
      const n = src.indexOf("*/", i);
      i = n < 0 ? src.length : n + 2;
      continue;
    }
    break;
  }
  const m = /^(["'])(use server|use client)\1/.exec(src.slice(i));
  return m ? m[2] : null;
}

/**
 * What a "use server" module is allowed to export. Types are erased before the
 * bundler ever sees them, so they are always safe; everything else must be an
 * async function, because Next turns any other export into a callable
 * reference rather than the value you wrote.
 */
const ALLOWED_EXPORT = [
  /^export\s+(type|interface)\b/,
  /^export\s+async\s+function\b/,
  /^export\s+default\s+async\s+function\b/,
  /^export\s+(const|let|var)\s+\w+\s*(:[^=]+)?=\s*async\b/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "generated") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

function checkServerModules(root: string) {
  console.log('\n1. "use server" modules export only async functions');
  const files = [...walk(join(root, "app")), ...walk(join(root, "lib"))];
  const servers: string[] = [];
  const offences: string[] = [];

  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (leadingDirective(src) !== "use server") continue;
    servers.push(relative(root, f));
    for (const line of src.split("\n")) {
      if (!/^export\b/.test(line)) continue;
      if (ALLOWED_EXPORT.some((r) => r.test(line))) continue;
      offences.push(`${relative(root, f)} → ${line.trim().slice(0, 70)}`);
    }
  }

  ok(`${servers.length} server-action modules found`, servers.length > 0);
  ok(
    "none exports a non-async value",
    offences.length === 0,
    offences.length ? `\n       ${offences.join("\n       ")}` : ""
  );

  // The two modules that were extracted precisely because of this rule. If
  // either drifts back under a "use server" directive, the panels that import
  // them break in the browser and nowhere else.
  for (const pure of ["lib/inventory/reasons.ts", "lib/orders/flow.ts"]) {
    const d = leadingDirective(readFileSync(join(root, pure), "utf8"));
    ok(`${pure} is a plain module`, d === null, `directive: ${d ?? "none"}`);
  }
}

/* ---------------------------------------------------------- 2. the server */

function killTree(pid: number) {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    process.kill(-pid, "SIGKILL");
  }
}

async function waitForServer(): Promise<boolean> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${ORIGIN}/admin/login`, { redirect: "manual" });
      if (r.status > 0) return true;
    } catch {
      // Not listening yet. Checking the port is the signal; there is nothing
      // to wait on but the socket.
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return false;
}

/* ------------------------------------------------------ 3. the test client */

type Jar = Map<string, string>;

/**
 * Signs in the way the app does.
 *
 * Deliberately uses @supabase/ssr rather than hand-building the auth cookie:
 * the cookie name, chunking and encoding are library implementation details
 * that have changed before. Letting setAll() hand us the exact cookies keeps
 * this correct across upgrades.
 */
async function signIn(jar: Jar, email: string, password: string) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
      },
    }
  );
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  // proxy.ts treats a missing idle stamp as expired, so a session cookie alone
  // would be bounced to /admin/login?reason=timeout.
  jar.set(IDLE_COOKIE, stampValue(Date.now()));
  return data.user;
}

const cookieHeader = (jar: Jar) =>
  [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function get(path: string, jar?: Jar) {
  const r = await fetch(ORIGIN + path, {
    redirect: "manual",
    headers: jar ? { cookie: cookieHeader(jar) } : {},
  });
  return { status: r.status, location: r.headers.get("location"), body: await r.text() };
}

type Chunk = { url: string; text: string };

/** Every .js the page pulls in — script tags and preload hints alike. */
async function bundleFor(html: string): Promise<Chunk[]> {
  const urls = new Set<string>();
  for (const m of html.matchAll(/(?:src|href)="([^"]+\.js)"/g)) urls.add(m[1]);
  return Promise.all(
    [...urls].map(async (u) => {
      try {
        const r = await fetch(u.startsWith("http") ? u : ORIGIN + u);
        return { url: u, text: r.ok ? await r.text() : "" };
      } catch {
        return { url: u, text: "" };
      }
    })
  );
}

const joined = (chunks: Chunk[]) => chunks.map((c) => c.text).join("\n");

/* ----------------------------------------------------------------- routes */

type Route = {
  path: string;
  label: string;
  /** Must appear in the server-rendered HTML. */
  html: string[];
  /** Must appear in the client JavaScript the page loads. */
  bundle?: string[];
};

async function main() {
  const root = process.cwd();
  checkServerModules(root);

  const email = process.env.RENDER_CHECK_EMAIL;
  const password = process.env.RENDER_CHECK_PASSWORD;
  if (!email || !password) {
    console.log(
      "\n\x1b[31mRENDER_CHECK_EMAIL / RENDER_CHECK_PASSWORD are not set.\x1b[0m\n" +
        "Add an admin account's credentials to .env to run the render sections.\n"
    );
    process.exitCode = 1;
    return;
  }

  // Real ids, so the detail routes are exercised against real rows rather than
  // a 404 that would still return HTML and look like a pass.
  const db = new Client({ connectionString: process.env.DIRECT_URL });
  await db.connect();
  const order = (
    await db.query(
      `select id, order_code, customer_name from orders order by created_at desc limit 1`
    )
  ).rows[0];
  const product = (
    await db.query(`select id, name from products where is_active order by name limit 1`)
  ).rows[0];
  await db.end();

  const routes: Route[] = [
    { path: "/admin", label: "Dashboard", html: ["Dashboard", "Inventory"] },
    {
      path: "/admin/orders",
      label: "Orders",
      // The inline advance button renders its accessible name as
      // "Mark order AT-XXXX as …", so its presence proves the control reached
      // the list and not just the order's own page.
      html: ["Orders", "Mark order "],
      bundle: ["Mark order "],
    },
    {
      path: `/admin/orders/${order.id}`,
      label: "Order detail",
      // Void renders immediately for a manager — not behind a click — so its
      // absence from the HTML is the thing worth catching.
      html: [order.order_code, order.customer_name, "Void this order"],
      bundle: ["Cancel this order", "Mark payment verified", "Confirm void"],
    },
    {
      path: "/admin/orders/voided",
      label: "Voided orders",
      html: ["Voided orders"],
    },
    { path: "/admin/invoices", label: "Invoices", html: ["Invoices"] },
    {
      path: `/admin/invoices/${order.id}`,
      label: "Invoice detail",
      html: [order.order_code],
    },
    {
      path: "/admin/inventory",
      label: "Inventory",
      html: ["Movement history", "Price history"],
      // The canary. These labels live in lib/inventory/reasons.ts and are read
      // from it here, so the check cannot drift out of step with the source:
      // move that file back under "use server" and every one of them vanishes
      // from the bundle.
      bundle: [
        ...REASONS.map((r) => r.label),
        "Save adjustment",
        "Received / removed",
        "Set branch price",
        "Use catalog price",
      ],
    },
    { path: "/admin/inventory/movements", label: "Stock movements", html: ["Stock movements"] },
    { path: "/admin/inventory/price-history", label: "Price history", html: ["Price history"] },
    { path: "/admin/inventory/products", label: "Products", html: ["Products"] },
    {
      path: "/admin/inventory/products/new",
      label: "New product",
      html: ["Create product", "Product image"],
      bundle: ["Create product", "No image"],
    },
    {
      path: `/admin/inventory/products/${product.id}`,
      label: "Edit product",
      html: [product.name, "Recent price changes", "Availability", "Image"],
      bundle: ["Add size", "Catalog price", "Replace image"],
    },
    {
      path: "/admin/invites",
      label: "Staff & invites",
      html: ["Send invitation"],
      bundle: ["Send invitation"],
    },
    {
      path: "/admin/pos",
      label: "POS",
      html: ["Search products"],
      // "Yes, complete sale" only exists in the confirm step, which is behind a
      // click — so the bundle is the only place its absence would show.
      bundle: ["Complete sale", "Yes, complete sale", "Ring up this sale?"],
    },
  ];

  // Kept open for the whole run so the storefront section can read the brand
  // name and a product name to assert against, rather than hardcoding copy
  // that would rot the moment the shop is edited.
  const db2 = new Client({ connectionString: process.env.DIRECT_URL });
  await db2.connect();

  console.log("\n2. Booting the production build");
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    stdio: "ignore",
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
  });

  try {
    const up = await waitForServer();
    ok(`server listening on ${PORT}`, up);
    if (!up) return;

    console.log("\n3. Access control");
    const anon = await get("/admin/inventory");
    ok(
      "anonymous visitor is redirected to login",
      anon.status === 307 && (anon.location ?? "").includes("/admin/login"),
      `${anon.status} → ${anon.location ?? "no redirect"}`
    );

    const jar: Jar = new Map();
    const user = await signIn(jar, email, password);
    ok("signed in", Boolean(user), user?.email ?? "");

    console.log("\n4. Every admin route renders");
    const bodies = new Map<string, string>();
    for (const r of routes) {
      const res = await get(r.path, jar);
      bodies.set(r.path, res.body);
      const served = res.status === 200;
      ok(
        `${r.label.padEnd(16)} ${r.path}`,
        served,
        served ? "" : `${res.status}${res.location ? ` → ${res.location}` : ""}`
      );
      if (!served) continue;
      const missing = r.html.filter((m) => !res.body.includes(m));
      ok(
        `${" ".repeat(16)} content present`,
        missing.length === 0,
        missing.length ? `missing: ${missing.join(", ")}` : `${r.html.length} markers`
      );
    }

    console.log("\n5. Interactive panels reach the browser");
    // A panel behind a click never shows up in the HTML, so this is the only
    // place its absence would ever be noticed.
    const chunksByRoute = new Map<string, Chunk[]>();
    for (const r of routes.filter((x) => x.bundle?.length)) {
      const html = bodies.get(r.path);
      if (!html) continue;
      const chunks = await bundleFor(html);
      chunksByRoute.set(r.path, chunks);
      const js = joined(chunks);
      const missing = r.bundle!.filter((s) => !js.includes(s));
      ok(
        `${r.label.padEnd(16)} ${r.bundle!.length} panel strings in client JS`,
        missing.length === 0,
        missing.length ? `missing: ${missing.join(" | ")}` : `${Math.round(js.length / 1024)}KB scanned`
      );
    }

    console.log("\n6. The Adjust panel's reason list, scoped to its own chunk");
    /*
     * Searching the whole bundle is too loose: reintroducing the bug left
     * "Expired" passing, because that word also appears in the invites UI. So
     * this locates the chunk holding the Adjust panel and requires every reason
     * to be in THAT file.
     *
     * Scoping by chunk rather than asserting on the emitted `{value:…,label:…}`
     * shape keeps it independent of how the minifier happens to write objects.
     */
    const invChunks = chunksByRoute.get("/admin/inventory") ?? [];
    const panel = invChunks.find((c) => c.text.includes("Save adjustment"));
    ok("the Adjust panel is in a client chunk", Boolean(panel), panel?.url ?? "not found");
    if (panel) {
      const absent = REASONS.filter((r) => !panel.text.includes(r.label)).map((r) => r.label);
      ok(
        `all ${REASONS.length} reasons ship alongside it`,
        absent.length === 0,
        absent.length ? `missing: ${absent.join(" | ")}` : panel.url
      );
    }

    console.log("\n7. The storefront renders for the public");
    /*
     * Fetched with NO cookies. These pages must work for a stranger, and the
     * commonest way a storefront breaks is a query that quietly assumes a
     * session — it renders perfectly for whoever built it and 500s for
     * customers.
     */
    const brand = (
      await db2.query(`select value #>> '{}' v from site_settings where key='brand.name'`)
    ).rows[0].v;
    const liveProducts: number = (
      await db2.query(
        `select count(distinct p.id)::int n
           from products p join categories c on c.id = p.category_id
          where p.is_active and c.is_active
            and exists (select 1 from product_sizes ps
                          join store_inventory si on si.product_size_id = ps.id and si.is_active
                         where ps.product_id = p.id and ps.is_active)`
      )
    ).rows[0].n;

    const firstProduct = (
      await db2.query(
        `select p.name from products p where p.is_active order by p.display_order, p.name limit 1`
      )
    ).rows[0].name;

    const store: Route[] = [
      {
        path: "/",
        label: "Home",
        html: [
          brand,
          "Fan Favorites",
          "Our Story",
          "What Our Customers Say",
          "Get In Touch",
          // Every carousel slide is in the HTML, not just the active one, so a
          // crawler and a reader with no JavaScript see all five.
          "Featured This Week",
          'aria-roledescription="carousel"',
        ],
      },
      { path: "/shop", label: "Shop", html: ["Shop", firstProduct, "Peanuts"] },
      { path: "/shop?category=peanuts", label: "Shop filtered", html: ["Peanuts"] },
      { path: "/shop?q=mani", label: "Shop search", html: ["mani"] },
      {
        path: "/shop?category=does-not-exist",
        label: "Unknown category",
        html: ["That category doesn&#x27;t exist"],
      },
      { path: "/shop?sort=price-asc", label: "Shop sorted", html: ["Price: Low to High"] },
      {
        path: "/checkout",
        label: "Checkout",
        // GCash and Bank Transfer are the surviving prepay options; QR Ph was
        // retired, and a retired method must not still be offered.
        // The QR is the thing a customer actually pays from, so its absence
        // matters as much as the method's. /images/Gcash.jpg is served from
        // public/, so a missing file shows up here as a missing marker.
        html: ["Checkout", "GCash", "Bank Transfer", "/images/Gcash.jpg"],
      },
    ];

    for (const r of store) {
      const res = await get(r.path);
      const served = res.status === 200;
      ok(`${r.label.padEnd(17)} ${r.path}`, served,
        served ? "" : `${res.status}${res.location ? ` → ${res.location}` : ""}`);
      if (!served) continue;
      const missing = r.html.filter((m) => !res.body.includes(m));
      ok(`${" ".repeat(17)} content present`, missing.length === 0,
        missing.length ? `missing: ${missing.join(", ")}` : `${r.html.length} markers`);
    }

    /*
     * The shop now ships the whole catalogue and filters in the browser, so a
     * filtered page is no LIGHTER than the unfiltered one — the same array is
     * serialised either way. Page weight is therefore no longer evidence of
     * anything; what matters is that the server-rendered HTML is already
     * filtered, because that is what a shared link and a crawler see.
     *
     * Counting rendered cards against the database's own count checks exactly
     * that, and would catch a hydration-only filter that renders everything
     * first and corrects itself.
     */
    const cards = (html: string) => (html.match(/<article/g) ?? []).length;

    const wholeShop = await get("/shop");
    ok("every product is rendered unfiltered", cards(wholeShop.body) === liveProducts,
      `${cards(wholeShop.body)} cards vs ${liveProducts} products`);

    for (const slug of ["seeds", "peanuts"]) {
      const expected = (
        await db2.query(
          `select count(distinct p.id)::int n
             from products p join categories c on c.id = p.category_id
            where p.is_active and c.is_active and c.slug = $1
              and exists (select 1 from product_sizes ps
                            join store_inventory si on si.product_size_id = ps.id and si.is_active
                           where ps.product_id = p.id and ps.is_active)`,
          [slug]
        )
      ).rows[0].n;
      const res = await get(`/shop?category=${slug}`);
      ok(`?category=${slug} is filtered in the server HTML`,
        cards(res.body) === expected, `${cards(res.body)} cards vs ${expected} expected`);
    }

    const searched = await get("/shop?q=mani");
    ok("a search narrows the server-rendered grid",
      cards(searched.body) > 0 && cards(searched.body) < liveProducts,
      `${cards(searched.body)} of ${liveProducts}`);

    /*
     * The storefront's client-component budget, asserted structurally rather
     * than in bytes.
     *
     * A byte budget was the obvious thing to write here and it measures the
     * wrong quantity: nearly all of what a page downloads is the shared React
     * and Next runtime, identical on every route, so the number barely moves
     * whatever these files do. It would have passed a change that turned the
     * whole product grid into client code.
     *
     * What actually matters is which modules opt into the client. The grid, the
     * cards and the filters are Server Components deliberately — a single
     * "use client" on any of them pulls the entire catalogue render into the
     * browser. Naming the permitted set makes that regression a failure and
     * says why in the diff.
     */
    const ALLOWED_CLIENT = [
      "app/(store)/_components/site-header.tsx", // mobile drawer, needs state
      "app/(store)/_components/product-image.tsx", // needs onError
      "app/(store)/_components/cart-ui.tsx", // cart lives in the browser
      "app/(store)/_components/add-to-cart.tsx", // size choice + add
      "app/(store)/checkout/_components/checkout-form.tsx", // a form with state
      "app/(store)/shop/_components/shop-browser.tsx", // filters in the browser
      "app/(store)/_components/hero-carousel.tsx", // autoplay + slide state
      "app/(store)/_components/reveal.tsx", // IntersectionObserver
    ];
    const storeClients = walk(join(root, "app", "(store)"))
      .filter((f) => leadingDirective(readFileSync(f, "utf8")) === "use client")
      .map((f) => relative(root, f).replace(/\\/g, "/"));
    const unexpected = storeClients.filter((f) => !ALLOWED_CLIENT.includes(f));

    ok(
      `only ${ALLOWED_CLIENT.length} storefront modules are client components`,
      unexpected.length === 0,
      unexpected.length ? `unexpected: ${unexpected.join(", ")}` : storeClients.join(", ")
    );

    // Reported, not asserted — context for the line above.
    for (const path of ["/", "/shop"]) {
      const kb = Math.round(joined(await bundleFor((await get(path)).body)).length / 1024);
      console.log(`       ${path.padEnd(6)} downloads ${kb}KB of JS (mostly the shared runtime)`);
    }

    /*
     * A URL in the HTML is not a working image. These are the codes customers
     * scan in order to pay, so the file has to actually serve — a renamed or
     * missing one is a silently broken payment, not a broken thumbnail.
     */
    const qrRows = (
      await db2.query(
        `select name, qr_image_path from payment_methods
          where is_active and qr_image_path is not null order by display_order`
      )
    ).rows as Array<{ name: string; qr_image_path: string }>;
    ok("payment QRs are configured", qrRows.length > 0, `${qrRows.length} method(s)`);
    for (const row of qrRows) {
      const res = await fetch(ORIGIN + row.qr_image_path);
      const type = res.headers.get("content-type") ?? "";
      ok(
        `${row.name} QR serves an image`,
        res.status === 200 && type.startsWith("image/"),
        `HTTP ${res.status} ${type || "no content-type"}`
      );
    }

    console.log("\n7c. Home page animation");
    const home = (await get("/")).body;

    /*
     * Every carousel slide must be in the server HTML, not just the active one.
     * Mounting a single slide at a time would leave four of five products
     * invisible to a crawler and to anyone without JavaScript.
     */
    const slides = (
      await db2.query(
        `select name from products where is_active and is_featured
          order by display_order, name limit 5`
      )
    ).rows as Array<{ name: string }>;
    const absent = slides.filter((r) => !home.includes(`Show ${r.name}`));
    ok(
      `all ${slides.length} carousel slides are server-rendered`,
      slides.length > 0 && absent.length === 0,
      absent.length ? `missing: ${absent.map((r) => r.name).join(", ")}` : ""
    );

    ok("reveal wrappers are present", home.includes("data-reveal="));

    /*
     * The safety net, asserted rather than assumed. Reveal starts its children
     * at opacity 0; if this rule ever stopped shipping, a visitor with
     * JavaScript disabled would get a blank page rather than a plain one.
     */
    ok(
      "noscript keeps revealed content visible without JavaScript",
      home.includes("[data-reveal]{opacity:1!important")
    );

    console.log("\n7b. The cart reaches the browser");
    /*
     * The cart is entirely client-side, so unlike the rest of the storefront
     * its absence would not show up in any HTML assertion — the shop would
     * render perfectly and simply refuse to take an order.
     *
     * "at-cart-v1" is the localStorage key: finding it proves the store module
     * itself shipped, not merely a component that imports from it.
     */
    const shopJs = joined(await bundleFor((await get("/shop")).body));
    for (const marker of ["Add to cart", "Your cart", "at-cart-v1", "Checkout"]) {
      ok(`cart: "${marker}" shipped`, shopJs.includes(marker));
    }

    console.log("\n8. The shell itself is interactive");
    const shellJs = joined(await bundleFor(bodies.get("/admin") ?? ""));
    for (const s of ["Collapse navigation", "Close navigation", "Admin sections"]) {
      ok(`nav: "${s}" shipped`, shellJs.includes(s));
    }
  } finally {
    await db2.end().catch(() => {});
    await db2.end().catch(() => {});
    if (server.pid) killTree(server.pid);
  }

  console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("\ncheck failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
