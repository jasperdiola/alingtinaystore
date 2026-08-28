import Link from "next/link";
import type { Branch } from "@/lib/queries/storefront";
import {
  FacebookIcon,
  InstagramIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
} from "./icons";

/**
 * Footer — a Server Component, since every value comes from the database and
 * nothing here reacts to anything.
 *
 * Branch addresses are listed in full rather than hidden behind a "Locations"
 * link: this is a three-branch local shop, and "where can I actually buy this"
 * is the question the footer exists to answer.
 */
export default function SiteFooter({
  settings,
  branches,
}: {
  settings: Record<string, string>;
  branches: Branch[];
}) {
  const brand = settings["brand.name"] ?? "Aling Tinay's";
  const founded = settings["brand.founded_year"];
  const year = new Date().getFullYear();

  return (
    <footer className="bg-roasted text-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-12">
          <div className="space-y-4 lg:col-span-2">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid size-10 place-items-center rounded-lg bg-cream text-base font-bold text-roasted">
                A
              </span>
              <span className="text-lg font-bold tracking-tight">{brand}</span>
            </Link>
            <p className="max-w-sm text-sm leading-relaxed text-white/60">
              {settings["brand.tagline"]}
            </p>
            <div className="flex items-center gap-3">
              {settings["social.facebook"] && (
                <a
                  href={settings["social.facebook"]}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${brand} on Facebook`}
                  className="flex size-11 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-peanut"
                >
                  <FacebookIcon className="h-4 w-4" />
                </a>
              )}
              {settings["social.instagram"] && (
                <a
                  href={settings["social.instagram"]}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${brand} on Instagram`}
                  className="flex size-11 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-peanut"
                >
                  <InstagramIcon className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold">Get in touch</h2>
            <ul className="mt-4 space-y-3 text-sm text-white/70">
              {settings["contact.phone"] && (
                <li>
                  <a
                    href={`tel:${settings["contact.phone_e164"] ?? settings["contact.phone"]}`}
                    className="flex items-center gap-2.5 transition-colors hover:text-white"
                  >
                    <PhoneIcon className="h-4 w-4 shrink-0 text-peanut" />
                    {settings["contact.phone"]}
                  </a>
                </li>
              )}
              {settings["contact.email"] && (
                <li>
                  <a
                    href={`mailto:${settings["contact.email"]}`}
                    className="flex items-start gap-2.5 transition-colors hover:text-white"
                  >
                    <MailIcon className="mt-0.5 h-4 w-4 shrink-0 text-peanut" />
                    <span className="break-all">{settings["contact.email"]}</span>
                  </a>
                </li>
              )}
            </ul>
          </div>

          <div>
            <h2 className="text-sm font-semibold">
              Our branches
              <span className="ml-1.5 font-normal text-white/40">({branches.length})</span>
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-white/70">
              {branches.map((b) => (
                <li key={b.id} className="flex items-start gap-2.5">
                  <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-peanut" />
                  <span>
                    <span className="block font-medium text-white/90">{b.name}</span>
                    {b.address && (
                      <span className="block text-xs leading-relaxed text-white/50">
                        {b.address}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {brand}
            {founded && ` · Roasting since ${founded}`}
          </p>
        </div>
      </div>
    </footer>
  );
}
