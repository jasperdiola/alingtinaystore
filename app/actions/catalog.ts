"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { adminAtLeast, getAdminSession } from "@/lib/auth/admin";
import { withActor } from "@/lib/auth/db-actor";
import {
  checkImage,
  imagePath,
  isOwnUpload,
  pathFromPublicUrl,
  PRODUCT_BUCKET,
} from "@/lib/products/images";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type ActionState = { ok: boolean; message: string; id?: string } | null;

/**
 * Authorization gate. Every mutating action below starts with this.
 *
 * Mirrors your products_admin_write RLS policy, which is
 * admin_at_least('manager') — cashiers adjust stock, they do not change the
 * catalog. The check happens here rather than around a component because
 * Server Actions stay reachable by POST whether or not anything renders them,
 * and this database connection bypasses RLS.
 */
type Gate =
  | { denied: true; message: string }
  | { denied: false; actorId: string };

async function requireAdmin(): Promise<Gate> {
  const session = await getAdminSession();
  if (!session) return { denied: true, message: "You are not signed in." };
  if (!(await adminAtLeast("manager"))) {
    return { denied: true, message: `Your role (${session.role}) cannot change the product catalog.` };
  }
  // Returned, never stashed in a module variable: this module is shared by
  // every concurrent request, so a module-level actor id would let two admins
  // saving at the same moment be recorded as each other.
  return { denied: false, actorId: session.userId };
}

// products_slug_check enforces ^[a-z0-9]+(-[a-z0-9]+)*$
function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "") // ñ -> n, é -> e (rather than "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const MONEY = /^\d+(\.\d{1,2})?$/;
const money = (fd: FormData, k: string) => {
  const raw = String(fd.get(k) ?? "").trim();
  return MONEY.test(raw) ? raw : null;
};
const count = (fd: FormData, k: string) => {
  const n = Number(String(fd.get(k) ?? "").trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
};
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const flag = (fd: FormData, k: string) => String(fd.get(k) ?? "") === "on";

/** Turns Prisma / Postgres failures into something readable in the UI. */
function explain(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return "That name is already taken — slugs must be unique.";
    if (e.code === "P2003") return "Foreign key failed — that category or store no longer exists.";
    if (e.code === "P2025") return "Record not found. Someone may have removed it already.";
  }
  const msg = e instanceof Error ? e.message : String(e);
  const check = msg.match(/violates check constraint "([^"]+)"/);
  if (check) {
    const hints: Record<string, string> = {
      original_price_gt_base: "the compare-at price must be higher than the price.",
      products_base_price_check: "price must be 0 or more.",
      products_slug_check: "name must contain letters or numbers.",
      products_name_check: "name must be 1–160 characters.",
      product_sizes_label_check: "size label must be 1–60 characters.",
      product_sizes_price_check: "size price must be 0 or more.",
      store_inventory_stock_check: "stock must be 0 or more.",
    };
    return `Rejected by ${check[1]}${hints[check[1]] ? ` — ${hints[check[1]]}` : ""}`;
  }
  return msg.split("\n").filter(Boolean).slice(-1)[0]?.trim() || "Unknown error.";
}

/* ------------------------------------------------------------------ IMAGES */

/**
 * Uploads one image to the product-images bucket and returns its public URL.
 *
 * Goes through the caller's own Supabase session rather than a service-role
 * key, so the bucket's "atp product images admin write" policy
 * (admin_at_least('manager')) is what authorises the write. The application
 * check in requireAdmin() and the storage policy then agree, and neither alone
 * is load-bearing.
 */
async function uploadImage(
  productId: string,
  file: File
): Promise<{ url: string } | { error: string }> {
  const problem = checkImage(file);
  if (problem) return { error: problem };

  const supabase = await createSupabaseServerClient();
  const path = imagePath(productId, file);

  const { error } = await supabase.storage
    .from(PRODUCT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    // The most common cause by far is the RLS policy, which reads as a
    // generic failure. Say what it probably is rather than echoing the noise.
    return {
      error: /row-level security|Unauthorized/i.test(error.message)
        ? "The storage bucket refused the upload — your role may not allow it."
        : `Upload failed: ${error.message}`,
    };
  }

  const { data } = supabase.storage.from(PRODUCT_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

/** Best-effort cleanup. A leftover object is harmless; a wrong URL is not. */
async function removeImage(url: string | null | undefined): Promise<void> {
  if (!isOwnUpload(url)) return;
  const path = pathFromPublicUrl(url!);
  if (!path) return;
  const supabase = await createSupabaseServerClient();
  await supabase.storage.from(PRODUCT_BUCKET).remove([path]);
}

/**
 * Replace (or set) a product's image.
 *
 * Writes all three places the schema keeps an image — products.image,
 * products.images[] and the product_images row — because all three are
 * populated in your data and v_store_catalog reads the products columns while
 * product_images carries the gallery. Letting them drift would mean the
 * storefront and the product page disagree about what the product looks like.
 */
export async function setProductImageAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const gate = await requireAdmin();
  if (gate.denied) return { ok: false, message: gate.message };

  const id = text(formData, "id");
  if (!id) return { ok: false, message: "Missing product." };

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose an image first." };
  }

  const existing = await prisma.products.findUnique({
    where: { id },
    select: { image: true, images: true },
  });
  if (!existing) return { ok: false, message: "That product no longer exists." };

  const up = await uploadImage(id, file);
  if ("error" in up) return { ok: false, message: up.error };

  try {
    await withActor(gate.actorId, async (tx) => {
      await tx.products.update({
        where: { id },
        data: {
          image: up.url,
          // The new image leads; anything previously uploaded is dropped from
          // the gallery, but externally hosted URLs are kept.
          images: [up.url, ...existing.images.filter((u) => u !== existing.image && !isOwnUpload(u))],
        },
      });
      await tx.product_images.updateMany({
        where: { product_id: id },
        data: { is_primary: false },
      });
      await tx.product_images.create({
        data: { product_id: id, url: up.url, is_primary: true, display_order: 0 },
      });
    });
  } catch (e) {
    // The database is the record of truth; an uploaded file it does not point
    // at is litter, so remove it rather than leave a half-applied change.
    await removeImage(up.url);
    return { ok: false, message: explain(e) };
  }

  // The previous upload is now unreferenced.
  if (existing.image !== up.url) await removeImage(existing.image);

  revalidatePath("/admin/inventory/products");
  revalidatePath(`/admin/inventory/products/${id}`);
  return { ok: true, message: "Image updated. The storefront will show it now." };
}

/* ------------------------------------------------------------------ CREATE */

export async function createProductAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const gate = await requireAdmin();
  if (gate.denied) return { ok: false, message: gate.message };

  const name = text(formData, "name");
  const categoryId = text(formData, "categoryId");
  const description = text(formData, "description");
  const sizeLabel = text(formData, "sizeLabel");
  const basePrice = money(formData, "basePrice");
  const sizePrice = money(formData, "sizePrice") ?? basePrice;
  const stock = count(formData, "stock") ?? 0;
  const storeIds = formData.getAll("storeIds").map(String).filter(Boolean);
  const slug = slugify(name);

  if (name.length < 1 || name.length > 160) return { ok: false, message: "Name must be 1–160 characters." };
  if (!slug) return { ok: false, message: "Name must contain at least one letter or number." };
  if (!categoryId) return { ok: false, message: "Pick a category." };
  if (sizeLabel.length < 1 || sizeLabel.length > 60) return { ok: false, message: "Size label must be 1–60 characters." };
  if (basePrice === null) return { ok: false, message: "Price must be a number with up to 2 decimals." };
  if (storeIds.length === 0) return { ok: false, message: "Choose at least one branch to stock it." };

  /*
   * The id is generated here rather than by the database default so the image
   * can be uploaded to its final path BEFORE the product row exists.
   *
   * The alternative — create, then upload, then update — leaves a product with
   * no image whenever the upload fails. This way the only failure debris is an
   * unreferenced file, which the catch below deletes.
   */
  const productId = randomUUID();
  const file = formData.get("image");
  let imageUrl: string | null = null;

  if (file instanceof File && file.size > 0) {
    const up = await uploadImage(productId, file);
    if ("error" in up) return { ok: false, message: up.error };
    imageUrl = up.url;
  }

  try {
    // A product is not sellable until it has a size and a branch holding it:
    // products -> product_sizes -> store_inventory. All or nothing, or you get
    // a product that exists but can never be added to an order.
    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.products.create({
        data: {
          id: productId,
          name,
          slug,
          category_id: categoryId,
          base_price: basePrice,
          description,
          short_description: description.slice(0, 160),
          ...(imageUrl ? { image: imageUrl, images: [imageUrl] } : {}),
        },
        select: { id: true },
      });

      if (imageUrl) {
        await tx.product_images.create({
          data: { product_id: product.id, url: imageUrl, is_primary: true, display_order: 0 },
        });
      }

      const size = await tx.product_sizes.create({
        data: { product_id: product.id, label: sizeLabel, price: sizePrice! },
        select: { id: true },
      });

      // createMany is one INSERT for all branches rather than one per branch.
      await tx.store_inventory.createMany({
        data: storeIds.map((store_id) => ({
          store_id,
          product_size_id: size.id,
          stock,
          // effective_price omitted — sync_effective_price() derives it.
        })),
      });

      return product;
    });

    revalidatePath("/admin/inventory");
    revalidatePath("/admin/inventory/products");
    return {
      ok: true,
      id: created.id,
      message:
        `Created "${name}" in ${storeIds.length} branch${storeIds.length === 1 ? "" : "es"}` +
        (imageUrl ? " with its image." : ". Add an image from its page so the storefront can show it."),
    };
  } catch (e) {
    // Nothing references the upload now, so it must not be left behind.
    await removeImage(imageUrl);
    return { ok: false, message: explain(e) };
  }
}

/* ------------------------------------------------------------------ UPDATE */

export async function updateProductAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const gate = await requireAdmin();
  if (gate.denied) return { ok: false, message: gate.message };

  const id = text(formData, "id");
  const name = text(formData, "name");
  const categoryId = text(formData, "categoryId");
  const basePrice = money(formData, "basePrice");
  const originalRaw = text(formData, "originalPrice");
  const displayOrder = count(formData, "displayOrder") ?? 0;

  if (!id) return { ok: false, message: "Missing product." };
  if (name.length < 1 || name.length > 160) return { ok: false, message: "Name must be 1–160 characters." };
  if (!categoryId) return { ok: false, message: "Pick a category." };
  if (basePrice === null) return { ok: false, message: "Price must be a number with up to 2 decimals." };
  if (originalRaw && !MONEY.test(originalRaw)) {
    return { ok: false, message: "Compare-at price must be a number with up to 2 decimals." };
  }
  // original_price_gt_base rejects this anyway; saying so here is friendlier.
  if (originalRaw && Number(originalRaw) <= Number(basePrice)) {
    return { ok: false, message: "Compare-at price must be higher than the price." };
  }

  try {
    // The slug is deliberately NOT regenerated from a renamed product. It is a
    // public URL; silently changing it breaks every existing link and any
    // storefront bookmark.
    await withActor(gate.actorId, (tx) =>
      tx.products.update({
      where: { id },
      data: {
        name,
        category_id: categoryId,
        base_price: basePrice,
        original_price: originalRaw ? originalRaw : null,
        description: text(formData, "description"),
        short_description: text(formData, "shortDescription"),
        image: text(formData, "image"),
        is_featured: flag(formData, "isFeatured"),
        is_best_seller: flag(formData, "isBestSeller"),
        display_order: displayOrder,
      },
      })
    );
  } catch (e) {
    return { ok: false, message: explain(e) };
  }

  revalidatePath("/admin/inventory/products");
  revalidatePath(`/admin/inventory/products/${id}`);
  revalidatePath("/admin/inventory");
  return { ok: true, message: `Saved "${name}".` };
}

/* -------------------------------------------------------- activate / retire */

/**
 * Retiring a product is a deactivation, never a delete.
 *
 * order_items.product_id is ON DELETE SET NULL, so deleting a product silently
 * severs every historical order line from it. The product_name snapshot on the
 * line survives, but the link — and any future "what did we sell" query — does
 * not. Every product here already has order history.
 */
export async function setProductActiveAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const gate = await requireAdmin();
  if (gate.denied) return { ok: false, message: gate.message };

  const id = text(formData, "id");
  const active = String(formData.get("active") ?? "") === "1";
  if (!id) return { ok: false, message: "Missing product." };

  const p = await prisma.products.findUnique({
    where: { id },
    select: { name: true, is_active: true },
  });
  if (!p) return { ok: false, message: "That product no longer exists." };
  if (p.is_active === active) {
    return { ok: false, message: `Already ${active ? "active" : "retired"}.` };
  }

  await prisma.products.update({ where: { id }, data: { is_active: active } });

  revalidatePath("/admin/inventory/products");
  revalidatePath(`/admin/inventory/products/${id}`);
  revalidatePath("/admin/inventory");
  return {
    ok: true,
    message: active
      ? `"${p.name}" is back on sale.`
      : `"${p.name}" retired — hidden from the storefront and the register, history kept.`,
  };
}

/* -------------------------------------------------------------------- sizes */

export async function addSizeAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const gate = await requireAdmin();
  if (gate.denied) return { ok: false, message: gate.message };

  const productId = text(formData, "productId");
  const label = text(formData, "label");
  const price = money(formData, "price");
  const weight = text(formData, "weight");
  const stock = count(formData, "stock") ?? 0;
  const storeIds = formData.getAll("storeIds").map(String).filter(Boolean);

  if (!productId) return { ok: false, message: "Missing product." };
  if (label.length < 1 || label.length > 60) return { ok: false, message: "Size label must be 1–60 characters." };
  if (price === null) return { ok: false, message: "Price must be a number with up to 2 decimals." };
  if (storeIds.length === 0) return { ok: false, message: "Choose at least one branch." };

  try {
    await prisma.$transaction(async (tx) => {
      const last = await tx.product_sizes.findFirst({
        where: { product_id: productId },
        orderBy: { display_order: "desc" },
        select: { display_order: true },
      });
      const size = await tx.product_sizes.create({
        data: {
          product_id: productId,
          label,
          price,
          weight: weight || null,
          display_order: (last?.display_order ?? -1) + 1,
        },
        select: { id: true },
      });
      await tx.store_inventory.createMany({
        data: storeIds.map((store_id) => ({ store_id, product_size_id: size.id, stock })),
      });
    });
  } catch (e) {
    return { ok: false, message: explain(e) };
  }

  revalidatePath(`/admin/inventory/products/${productId}`);
  revalidatePath("/admin/inventory");
  return { ok: true, message: `Added size "${label}" to ${storeIds.length} branch(es).` };
}

export async function setSizeActiveAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const gate = await requireAdmin();
  if (gate.denied) return { ok: false, message: gate.message };

  const id = text(formData, "id");
  const active = String(formData.get("active") ?? "") === "1";
  if (!id) return { ok: false, message: "Missing size." };

  const s = await prisma.product_sizes.findUnique({
    where: { id },
    select: { label: true, product_id: true, products: { select: { _count: { select: { product_sizes: true } } } } },
  });
  if (!s) return { ok: false, message: "That size no longer exists." };

  // A product with no sellable size cannot be ordered at all, so the last one
  // may not be retired.
  if (!active) {
    const remaining = await prisma.product_sizes.count({
      where: { product_id: s.product_id, is_active: true },
    });
    if (remaining <= 1) {
      return { ok: false, message: "That is the only active size. Retire the whole product instead." };
    }
  }

  await prisma.product_sizes.update({ where: { id }, data: { is_active: active } });

  revalidatePath(`/admin/inventory/products/${s.product_id}`);
  revalidatePath("/admin/inventory");
  return { ok: true, message: `Size "${s.label}" ${active ? "restored" : "retired"}.` };
}

/* ------------------------------------------------------- branch availability */

/** Put an existing size into a branch that does not carry it yet. */
export async function stockSizeInStoreAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const gate = await requireAdmin();
  if (gate.denied) return { ok: false, message: gate.message };

  const sizeId = text(formData, "sizeId");
  const storeId = text(formData, "storeId");
  const stock = count(formData, "stock") ?? 0;
  if (!sizeId || !storeId) return { ok: false, message: "Missing size or branch." };

  try {
    // store_inventory has a unique (store_id, product_size_id); this turns a
    // double-submit into a no-op rather than an error.
    await prisma.store_inventory.upsert({
      where: { store_id_product_size_id: { store_id: storeId, product_size_id: sizeId } },
      create: { store_id: storeId, product_size_id: sizeId, stock },
      update: { is_active: true },
    });
  } catch (e) {
    return { ok: false, message: explain(e) };
  }

  revalidatePath("/admin/inventory");
  return { ok: true, message: "Branch now carries this size." };
}
