import { getBranches, getSettings } from "@/lib/queries/storefront";
import { CartDrawer } from "./_components/cart-ui";
import SiteFooter from "./_components/site-footer";
import SiteHeader from "./_components/site-header";

/**
 * The customer-facing shell.
 *
 * A route group, so these pages sit at `/` and `/shop` while keeping a layout
 * entirely separate from `/admin` — different typeface, different palette,
 * different chrome, no shared state to get wrong.
 *
 * Settings and branches are read here and passed down. Both are wrapped in
 * React.cache, so a page that also needs them gets the same result without a
 * second round trip.
 */
export default async function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, branches] = await Promise.all([getSettings(), getBranches()]);

  return (
    <div className="flex min-h-screen flex-col bg-cream font-display text-gray-900">
      {/* Without JavaScript nothing reveals, so everything Reveal wraps would
          stay invisible. This makes the page a plain readable document. */}
      <noscript>
        <style>{"[data-reveal]{opacity:1!important;transform:none!important}"}</style>
      </noscript>

      {/* Keyboard users should not have to tab the whole nav on every page. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to content
      </a>

      <SiteHeader
        brandName={settings["brand.name"] ?? "Aling Tinay's"}
        phone={settings["contact.phone"] ?? ""}
        phoneE164={settings["contact.phone_e164"] ?? settings["contact.phone"] ?? ""}
      />

      <main id="main" className="flex-1">
        {children}
      </main>

      <SiteFooter settings={settings} branches={branches} />

      {/* Mounted once at the shell so the cart survives navigation between
          Home and Shop rather than unmounting with the page. */}
      <CartDrawer />
    </div>
  );
}
