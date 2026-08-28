import type { Metadata } from "next";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBranches } from "@/lib/queries/storefront";
import CheckoutForm, { type PaymentOption } from "./_components/checkout-form";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  await connection();

  const [branches, methods, feeRow] = await Promise.all([
    getBranches(),
    prisma.payment_methods.findMany({
      where: { is_active: true },
      orderBy: { display_order: "asc" },
      select: {
        id: true,
        name: true,
        type: true,
        instructions: true,
        requires_proof: true,
        qr_image_path: true,
      },
    }),
    // Display only. The order uses the CHOSEN branch's own fee, read on the
    // server, so a customer switching branches can never fix their own price.
    prisma.stores.findFirst({
      where: { is_active: true },
      orderBy: { display_order: "asc" },
      select: { delivery_fee: true },
    }),
  ]);

  const payments: PaymentOption[] = methods.map((m) => ({
    id: m.id,
    name: m.name,
    // Carried to the client so the form can offer only the methods that suit
    // the chosen fulfilment, using the same rule the action enforces.
    type: m.type,
    instructions: m.instructions,
    requiresProof: m.requires_proof,
    // Null until a QR is uploaded; the form shows the written instructions
    // alone rather than a broken image frame.
    qrImagePath: m.qr_image_path,
  }));

  return (
    <div className="min-h-screen bg-cream pb-16 pt-20 sm:pt-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Checkout</h1>
          <p className="mt-1 text-sm text-gray-600">
            Almost there — tell us where this is going.
          </p>
        </div>

        <CheckoutForm
          branches={branches}
          payments={payments}
          deliveryFee={Number(feeRow?.delivery_fee ?? 0)}
        />
      </div>
    </div>
  );
}
