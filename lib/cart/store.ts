/**
 * The shopping cart. Pure browser state — no Next, no database, no React.
 *
 * Deliberately an external store read through useSyncExternalStore rather than
 * context-plus-effect. Reading localStorage during render is a hydration
 * mismatch (the server has no cart), and the usual fix — an effect that copies
 * storage into state — is a setState inside an effect, which renders an empty
 * cart first and then corrects it. useSyncExternalStore is built for exactly
 * this: getServerSnapshot returns an empty cart, the client subscribes.
 *
 * What is stored is intentionally minimal but denormalised: enough to render
 * the drawer without a round trip. The prices here are for DISPLAY ONLY. The
 * checkout action re-reads every price from the database and never trusts a
 * number that came back from a browser.
 */

export type CartLine = {
  /** product_sizes.id — unique per product+size, so it is the line identity. */
  sizeId: string;
  productId: string;
  productName: string;
  sizeLabel: string;
  /** Display price, refreshed server-side at checkout. */
  price: number;
  image: string | null;
  qty: number;
};

export type Cart = { lines: CartLine[] };

const KEY = "at-cart-v1";
const EMPTY: Cart = { lines: [] };
/** Stable identity, so useSyncExternalStore does not see a new object each read. */
const SERVER_SNAPSHOT: Cart = EMPTY;

/** One line can never exceed this — a typo should not order 900 kilos. */
export const MAX_QTY = 99;

let cache: Cart = EMPTY;
let raw: string | null = null;
const listeners = new Set<() => void>();

function read(): Cart {
  if (typeof window === "undefined") return EMPTY;
  let current: string | null = null;
  try {
    current = window.localStorage.getItem(KEY);
  } catch {
    // Private mode, or storage disabled. An in-memory cart still works for
    // this tab, which is better than the page throwing.
    return cache;
  }
  // getSnapshot must return a referentially stable value when nothing changed,
  // or React re-renders forever. Re-parse only when the stored text differs.
  if (current === raw) return cache;
  raw = current;
  cache = parse(current);
  return cache;
}

function parse(text: string | null): Cart {
  if (!text) return EMPTY;
  try {
    const data = JSON.parse(text) as Cart;
    if (!data || !Array.isArray(data.lines)) return EMPTY;
    // Storage is user-writable and survives deploys: a line from an older
    // shape would otherwise crash the drawer on render.
    const lines = data.lines.filter(
      (l): l is CartLine =>
        typeof l?.sizeId === "string" &&
        typeof l?.productId === "string" &&
        typeof l?.productName === "string" &&
        typeof l?.sizeLabel === "string" &&
        Number.isFinite(l?.price) &&
        Number.isInteger(l?.qty) &&
        l.qty > 0
    );
    return { lines };
  } catch {
    return EMPTY;
  }
}

function write(next: Cart) {
  cache = next;
  try {
    raw = JSON.stringify(next);
    window.localStorage.setItem(KEY, raw);
  } catch {
    // Keep the in-memory cart even when it cannot be persisted.
  }
  for (const fn of listeners) fn();
}

export const cartStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    // Another tab changing the cart must update this one, or a customer with
    // two tabs open checks out with a cart they can no longer see.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        raw = null; // force a re-parse
        fn();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(fn);
      window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot: read,
  getServerSnapshot: () => SERVER_SNAPSHOT,

  add(line: Omit<CartLine, "qty">, qty = 1) {
    const cart = read();
    const existing = cart.lines.find((l) => l.sizeId === line.sizeId);
    const lines = existing
      ? cart.lines.map((l) =>
          l.sizeId === line.sizeId
            ? { ...l, ...line, qty: Math.min(l.qty + qty, MAX_QTY) }
            : l
        )
      : [...cart.lines, { ...line, qty: Math.min(qty, MAX_QTY) }];
    write({ lines });
  },

  setQty(sizeId: string, qty: number) {
    const cart = read();
    const lines =
      qty <= 0
        ? cart.lines.filter((l) => l.sizeId !== sizeId)
        : cart.lines.map((l) =>
            l.sizeId === sizeId ? { ...l, qty: Math.min(qty, MAX_QTY) } : l
          );
    write({ lines });
  },

  remove(sizeId: string) {
    cartStore.setQty(sizeId, 0);
  },

  clear() {
    write(EMPTY);
  },
};

/* ------------------------------------------------------------------ totals */

export const cartCount = (cart: Cart) =>
  cart.lines.reduce((n, l) => n + l.qty, 0);

/**
 * Rounded per line before summing.
 *
 * Money is decimal; summing floats and rounding once at the end can land a
 * centavo away from what the database computes, and orders.totals_balance
 * rejects the row when it disagrees.
 */
export const cartSubtotal = (cart: Cart) =>
  cart.lines.reduce((sum, l) => sum + Math.round(l.price * l.qty * 100) / 100, 0);

/** The wire format sent to the checkout action — ids and quantities only. */
export const toOrderLines = (cart: Cart) =>
  cart.lines.map((l) => ({ sizeId: l.sizeId, qty: l.qty }));
