// `server-only` makes the build fail loudly if this module is ever imported
// from a Client Component, instead of leaking DB access into the browser bundle.
import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * A DTO — the shape components actually consume.
 *
 * Note `price: number`, not Decimal. Prisma returns money columns as Decimal
 * class instances, and class instances CANNOT cross the Server -> Client
 * Component boundary. Converting here means every consumer is safe by default,
 * rather than each component remembering to convert.
 */
export type ProductCard = {
  id: string;
  name: string;
  slug: string;
  price: number;
  stock: number;
  image: string;
  description: string;
  categoryName: string;
};

export async function getActiveProducts(): Promise<ProductCard[]> {
  const rows = await prisma.products.findMany({
    where: { is_active: true },
    orderBy: [{ display_order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      base_price: true,
      stock: true,
      image: true,
      description: true,
      categories: { select: { name: true } },
    },
  });

  return rows.map(toCard);
}

export async function getProductsByCategory(
  categorySlug: string
): Promise<ProductCard[]> {
  const rows = await prisma.products.findMany({
    where: { is_active: true, categories: { slug: categorySlug } },
    orderBy: [{ display_order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      base_price: true,
      stock: true,
      image: true,
      description: true,
      categories: { select: { name: true } },
    },
  });

  return rows.map(toCard);
}

/**
 * Full detail for a single product page, including its size tiers.
 * Returns null rather than throwing so the caller can call notFound().
 */
export async function getProductBySlug(slug: string) {
  const product = await prisma.products.findUnique({
    where: { slug, is_active: true },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      short_description: true,
      base_price: true,
      original_price: true,
      image: true,
      images: true,
      stock: true,
      rating: true,
      reviews_count: true,
      categories: { select: { name: true, slug: true } },
      product_sizes: {
        where: { is_active: true },
        orderBy: { display_order: "asc" },
        select: { id: true, label: true, weight: true, price: true },
      },
    },
  });

  if (!product) return null;

  return {
    ...product,
    basePrice: Number(product.base_price),
    originalPrice:
      product.original_price === null ? null : Number(product.original_price),
    rating: Number(product.rating),
    base_price: undefined,
    original_price: undefined,
    sizes: product.product_sizes.map((s) => ({
      id: s.id,
      label: s.label,
      weight: s.weight,
      price: Number(s.price),
    })),
  };
}

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  base_price: { toString(): string };
  stock: number;
  image: string;
  description: string;
  categories: { name: string };
};

function toCard(row: ProductRow): ProductCard {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    price: Number(row.base_price),
    stock: row.stock,
    image: row.image,
    categoryName: row.categories.name,
  };
}
