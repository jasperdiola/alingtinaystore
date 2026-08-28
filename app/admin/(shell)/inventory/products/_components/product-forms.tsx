"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { ACCEPT_ATTR, checkImage } from "@/lib/products/images";
import {
  addSizeAction,
  createProductAction,
  setProductActiveAction,
  setProductImageAction,
  setSizeActiveAction,
  updateProductAction,
  type ActionState,
} from "@/app/actions/catalog";
import { setSizePriceAction, type PriceActionState } from "@/app/actions/pricing";
import type { ProductForEdit } from "@/lib/queries/catalog";

type Ref = { id: string; name: string };

const field =
  "h-9 w-full rounded-lg border border-neutral-300 px-2 text-sm dark:border-neutral-700 dark:bg-neutral-950";
const label = "text-[11px] text-neutral-500";
const primary =
  "h-9 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900";
const ghost =
  "h-9 rounded-lg border border-neutral-300 px-3 text-sm disabled:opacity-40 dark:border-neutral-700";

function Msg({ state }: { state: ActionState | PriceActionState }) {
  if (!state) return null;
  return (
    <p
      role="status"
      className={`text-xs ${
        state.ok ? "text-green-700 dark:text-green-400" : "text-rose-600 dark:text-rose-400"
      }`}
    >
      {state.ok ? "✓ " : "✗ "}
      {state.message}
    </p>
  );
}

/** Branch checkboxes — a product is unsellable until some branch carries it. */
function StorePicker({ stores, defaultAll = true }: { stores: Ref[]; defaultAll?: boolean }) {
  return (
    <fieldset className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <legend className={`px-1 ${label}`}>Stock it at</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {stores.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="storeIds"
              value={s.id}
              defaultChecked={defaultAll}
              className="size-4 rounded border-neutral-300 dark:border-neutral-600"
            />
            {s.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ create */

/**
 * File picker with a local preview.
 *
 * The preview comes from an object URL, so the cashier sees the actual image
 * before uploading rather than a filename — the cheapest way to stop the wrong
 * photo reaching the storefront. The same size and type rules the server
 * enforces are applied here so the mistake is caught before the upload, not
 * after it.
 */
export function ImagePicker({
  name = "image",
  currentUrl,
  label = "Product image",
  hint = "Shown to customers. JPEG, PNG, WebP or AVIF, up to 5MB.",
}: {
  name?: string;
  currentUrl?: string | null;
  label?: string;
  hint?: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Object URLs are leaked memory until revoked, and a cashier adding several
  // products in a row would accumulate one per pick.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function pick(file: File | undefined) {
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return file ? URL.createObjectURL(file) : null;
    });
    setProblem(file ? checkImage(file) : null);
  }

  const shown = preview ?? currentUrl ?? null;

  return (
    <div className="flex flex-col gap-2">
      <span className={label ? "text-xs font-medium text-neutral-600 dark:text-neutral-400" : ""}>
        {label}
      </span>
      <div className="flex items-start gap-3">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
          {shown ? (
            // A plain img, not next/image: the source is an in-browser blob
            // during preview, which the optimizer cannot process.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <span className="text-[10px] text-neutral-400">No image</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <input
            type="file"
            name={name}
            accept={ACCEPT_ATTR}
            onChange={(e) => pick(e.target.files?.[0])}
            className="block w-full text-xs file:mr-2 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-2 file:py-1 file:text-xs dark:file:border-neutral-600 dark:file:bg-neutral-800 dark:file:text-neutral-200"
          />
          <p className="mt-1 text-[11px] text-neutral-500">{hint}</p>
          {problem && (
            <p role="alert" className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
              {problem}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function CreateProductForm({
  categories,
  stores,
}: {
  categories: Ref[];
  stores: Ref[];
}) {
  const [state, action, pending] = useActionState(createProductAction, null as ActionState);
  const router = useRouter();

  // On success go straight to the editor — the create form only captures the
  // minimum needed to make a product sellable.
  useEffect(() => {
    if (state?.ok && state.id) router.push(`/admin/inventory/products/${state.id}`);
  }, [state, router]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${label} sm:col-span-2`}>
          Product name
          <input name="name" required maxLength={160} placeholder="Adobong Mani" className={`mt-1 ${field}`} />
        </label>

        <label className={label}>
          Category
          <select name="categoryId" required defaultValue="" className={`mt-1 ${field}`}>
            <option value="" disabled>Choose…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className={label}>
          Headline price (₱)
          <input name="basePrice" required inputMode="decimal" placeholder="250.00" className={`mt-1 ${field}`} />
        </label>

        <label className={`${label} sm:col-span-2`}>
          Description
          <textarea name="description" rows={2} className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950" />
        </label>

        <label className={label}>
          First size
          <input name="sizeLabel" required maxLength={60} defaultValue="1 Kilo" className={`mt-1 ${field}`} />
        </label>

        <label className={label}>
          Size price (₱)
          <input name="sizePrice" inputMode="decimal" placeholder="same as headline" className={`mt-1 ${field}`} />
        </label>

        <label className={label}>
          Opening stock per branch
          <input name="stock" inputMode="numeric" defaultValue="0" className={`mt-1 ${field}`} />
        </label>
      </div>

      <ImagePicker />

      <StorePicker stores={stores} />
      <Msg state={state} />

      <div>
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Creating…" : "Create product"}
        </button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------- edit */

export function EditProductForm({
  product,
  categories,
}: {
  product: ProductForEdit;
  categories: Ref[];
}) {
  const [state, action, pending] = useActionState(updateProductAction, null as ActionState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={product.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${label} sm:col-span-2`}>
          Product name
          <input name="name" required maxLength={160} defaultValue={product.name} className={`mt-1 ${field}`} />
          <span className="mt-1 block text-[11px] text-neutral-400">
            URL stays <code>{product.slug}</code> — renaming never changes it, so existing links keep working.
          </span>
        </label>

        <label className={label}>
          Category
          <select name="categoryId" required defaultValue={product.categoryId} className={`mt-1 ${field}`}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className={label}>
          Display order
          <input name="displayOrder" inputMode="numeric" defaultValue={product.displayOrder} className={`mt-1 ${field}`} />
        </label>

        <label className={label}>
          Headline price (₱)
          <input name="basePrice" required inputMode="decimal" defaultValue={product.basePrice.toFixed(2)} className={`mt-1 ${field}`} />
        </label>

        <label className={label}>
          Compare-at price (₱)
          <input
            name="originalPrice"
            inputMode="decimal"
            defaultValue={product.originalPrice?.toFixed(2) ?? ""}
            placeholder="optional"
            className={`mt-1 ${field}`}
          />
          <span className="mt-1 block text-[11px] text-neutral-400">
            Must exceed the price, or the database rejects it.
          </span>
        </label>

        <label className={`${label} sm:col-span-2`}>
          Short description
          <input name="shortDescription" defaultValue={product.shortDescription} className={`mt-1 ${field}`} />
        </label>

        <label className={`${label} sm:col-span-2`}>
          Description
          <textarea
            name="description"
            rows={3}
            defaultValue={product.description}
            className="mt-1 w-full rounded-lg border border-neutral-300 p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
        </label>

        <label className={`${label} sm:col-span-2`}>
          Image URL
          <input name="image" defaultValue={product.image} placeholder="https://…" className={`mt-1 ${field}`} />
        </label>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isFeatured" defaultChecked={product.isFeatured} className="size-4 rounded" />
          Featured
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isBestSeller" defaultChecked={product.isBestSeller} className="size-4 rounded" />
          Best seller
        </label>
      </div>

      <Msg state={state} />
      <div>
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------ retire toggle */

export function RetireProduct({
  id,
  isActive,
  soldCount,
}: {
  id: string;
  isActive: boolean;
  soldCount: number;
}) {
  const [state, action, pending] = useActionState(setProductActiveAction, null as ActionState);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-neutral-500">
        {soldCount > 0
          ? `Appears on ${soldCount} order line${soldCount === 1 ? "" : "s"}. Retiring hides it from the storefront and the register; the history stays intact.`
          : "Retiring hides it from the storefront and the register."}
      </p>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value={isActive ? "0" : "1"} />
        <button
          type="submit"
          disabled={pending}
          className={
            isActive
              ? "h-9 rounded-lg border border-rose-300 px-3 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
              : ghost
          }
        >
          {pending ? "…" : isActive ? "Retire product" : "Put back on sale"}
        </button>
      </form>
      <Msg state={state} />
    </div>
  );
}

/* ------------------------------------------------------------------- sizes */

export function SizeManager({
  product,
  stores,
}: {
  product: ProductForEdit;
  stores: Ref[];
}) {
  const [addState, add, adding] = useActionState(addSizeAction, null as ActionState);
  const [toggleState, toggle, toggling] = useActionState(setSizeActiveAction, null as ActionState);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {product.sizes.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className={`min-w-24 text-sm ${s.isActive ? "" : "text-neutral-400 line-through"}`}>
              {s.label}
            </span>
            <SizePriceEditor
              sizeId={s.id}
              price={s.price}
              pinned={s.stores.filter((x) => x.override !== null)}
              following={s.stores.filter((x) => x.override === null).length}
            />
            <span className="text-[11px] text-neutral-500">
              {s.stores.length} branch{s.stores.length === 1 ? "" : "es"} ·{" "}
              {s.stores.reduce((a, x) => a + x.stock, 0)} units
            </span>
            <form action={toggle} className="ml-auto">
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="active" value={s.isActive ? "0" : "1"} />
              <button type="submit" disabled={toggling} className={`${ghost} h-7 px-2 text-xs`}>
                {s.isActive ? "Retire" : "Restore"}
              </button>
            </form>
          </li>
        ))}
      </ul>
      <Msg state={toggleState} />

      {!showAdd ? (
        <div>
          <button type="button" onClick={() => setShowAdd(true)} className={ghost}>
            Add a size
          </button>
        </div>
      ) : (
        <form action={add} className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <input type="hidden" name="productId" value={product.id} />
          <div className="grid gap-3 sm:grid-cols-4">
            <label className={label}>
              Label
              <input name="label" required maxLength={60} placeholder="1/2 Kilo" className={`mt-1 ${field}`} />
            </label>
            <label className={label}>
              Weight
              <input name="weight" placeholder="optional" className={`mt-1 ${field}`} />
            </label>
            <label className={label}>
              Price (₱)
              <input name="price" required inputMode="decimal" className={`mt-1 ${field}`} />
            </label>
            <label className={label}>
              Opening stock
              <input name="stock" inputMode="numeric" defaultValue="0" className={`mt-1 ${field}`} />
            </label>
          </div>
          <StorePicker stores={stores} />
          <Msg state={addState} />
          <div className="flex gap-2">
            <button type="submit" disabled={adding} className={primary}>
              {adding ? "Adding…" : "Add size"}
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className={ghost}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Catalog price for one size, edited in place.
 *
 * The branch counts sit next to the field on purpose: cascade_size_price()
 * only moves branches WHERE price_override IS NULL, so a manager who raises a
 * price and sees two of three branches change would otherwise assume a bug.
 */
function SizePriceEditor({
  sizeId,
  price,
  pinned,
  following,
}: {
  sizeId: string;
  price: number;
  pinned: { store: string; override: number | null }[];
  following: number;
}) {
  const [state, action, saving] = useActionState(setSizePriceAction, null as PriceActionState);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(price.toFixed(2));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tabular-nums text-sm underline decoration-dotted underline-offset-4 hover:decoration-solid"
        title="Edit catalog price"
      >
        ₱{price.toFixed(2)}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="sizeId" value={sizeId} />
      <input
        name="price"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
        autoFocus
        aria-label="Catalog price"
        className="h-8 w-24 rounded-lg border border-neutral-300 px-2 text-sm tabular-nums dark:border-neutral-600 dark:bg-neutral-950"
      />
      <button type="submit" disabled={saving} className="h-8 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900">
        {saving ? "…" : "Apply"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-lg border border-neutral-300 px-2 text-xs dark:border-neutral-600">
        Cancel
      </button>
      <span className="text-[11px] text-neutral-500">
        {following} branch{following === 1 ? "" : "es"} follow
      </span>
      {pinned.length > 0 && (
        <span className="w-full text-[11px] text-amber-800 dark:text-amber-300">
          Will not change:{" "}
          {pinned.map((p) => `${p.store} (₱${p.override!.toFixed(2)})`).join(", ")}
        </span>
      )}
      <Msg state={state} />
    </form>
  );
}

/* ------------------------------------------------------------------- image */

/**
 * Upload or replace the image customers see.
 *
 * Separate from EditProductForm rather than another field inside it: a file
 * upload is slow and can fail on its own terms (size, type, the bucket policy),
 * and folding it into the details form would mean a rejected image also
 * discards an unsaved price or description change.
 */
export function ProductImage({
  id,
  currentUrl,
}: {
  id: string;
  currentUrl: string | null;
}) {
  const [state, action, pending] = useActionState(setProductImageAction, null as ActionState);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <ImagePicker
        currentUrl={currentUrl}
        label=""
        hint="Replacing removes the previous upload. JPEG, PNG, WebP or AVIF, up to 5MB."
      />
      <Msg state={state} />
      <div>
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Uploading…" : currentUrl ? "Replace image" : "Upload image"}
        </button>
      </div>
    </form>
  );
}
