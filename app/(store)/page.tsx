import Link from "next/link";
import { connection } from "next/server";
import {
  getBestSellers,
  getHeroSlides,
  getSettings,
  getShopProducts,
  getTestimonials,
  type StorefrontProduct,
  type Testimonial,
} from "@/lib/queries/storefront";
import {
  ArrowRightIcon,
  EyeIcon,
  HeartIcon,
  QuoteIcon,
  Stars,
  TargetIcon,
} from "./_components/icons";
import HeroCarousel from "./_components/hero-carousel";
import ProductCard from "./_components/product-card";
import Reveal from "./_components/reveal";

/**
 * Rendered per request rather than prerendered at build.
 *
 * Prices and stock are live: a build-time snapshot would show yesterday's
 * "Sold out" for a restocked product, and any CI runner without database access
 * would fail the build outright.
 */
export default async function HomePage() {
  await connection();

  const [heroSlides, bestSellers, all, testimonials, settings] = await Promise.all([
    getHeroSlides(5),
    getBestSellers(8),
    getShopProducts(),
    getTestimonials(),
    getSettings(),
  ]);

  // "Classic Favorites" is the rest of the catalogue, minus anything already
  // shown above — repeating the same eight tiles under a new heading is the
  // fastest way to make a shop look empty.
  const shownIds = new Set(bestSellers.map((p) => p.id));
  const classics = all.filter((p) => !shownIds.has(p.id)).slice(0, 8);

  return (
    <>
      <HeroCarousel slides={heroSlides} tagline={settings["brand.tagline"]} />

      <ProductSection
        eyebrow="Best Sellers"
        title="Fan Favorites"
        blurb="Our most-loved snacks, chosen by thousands of happy customers."
        products={bestSellers}
        className="bg-white"
      />

      <ProductSection
        eyebrow="More to love"
        title="Classic Favorites"
        blurb="The Filipino merienda staples, roasted fresh in small batches every morning."
        products={classics}
        className="bg-cream"
      />

      <StorySection settings={settings} />
      <TestimonialsSection testimonials={testimonials} />
      <ContactSection settings={settings} />
    </>
  );
}

/* ---------------------------------------------------------- product bands */

function ProductSection({
  eyebrow,
  title,
  blurb,
  products,
  className,
}: {
  eyebrow: string;
  title: string;
  blurb: string;
  products: StorefrontProduct[];
  className: string;
}) {
  if (products.length === 0) return null;

  return (
    <section className={`py-10 sm:py-16 lg:py-24 ${className}`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-8 text-center sm:mb-12" duration={600}>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-peanut sm:text-sm">
            {eyebrow}
          </span>
          <h2 className="mt-1.5 text-2xl font-bold text-gray-900 sm:mt-2 sm:text-4xl">
            {title}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-600 sm:mt-4 sm:text-base">
            {blurb}
          </p>
        </Reveal>

        <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4 lg:gap-8">
          {/* Not wrapped in a Link: the card contains its own buttons, and
              nesting a button inside an anchor is invalid and swallows clicks.

              Reveal is a Client Component, but ProductCard is passed to it as
              children — already rendered on the server — so the cards
              themselves never enter the client bundle. */}
          {products.map((p, i) => (
            <Reveal key={p.id} delay={i * 80} duration={500}>
              <ProductCard product={p} />
            </Reveal>
          ))}
        </div>

      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- story */

function StorySection({ settings }: { settings: Record<string, string> }) {
  const founded = Number(settings["brand.founded_year"]);
  const years = Number.isFinite(founded) ? new Date().getFullYear() - founded : null;

  return (
    <section id="our-story" className="bg-white py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <Reveal from="left" duration={700}>
            <span className="text-sm font-semibold uppercase tracking-wider text-peanut">
              Since {settings["brand.founded_year"]}
            </span>
            <h2 className="mt-2 text-3xl font-bold text-gray-900 sm:text-4xl">
              Our Story
            </h2>
            <p className="mt-4 leading-relaxed text-gray-600">
              {settings["about.story"]}
            </p>

            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div className="rounded-2xl bg-cream p-5">
                <TargetIcon className="mb-3 h-6 w-6 text-peanut" />
                <h3 className="mb-1 font-semibold text-gray-900">Our Mission</h3>
                <p className="text-sm text-gray-600">{settings["about.mission"]}</p>
              </div>
              <div className="rounded-2xl bg-cream p-5">
                <EyeIcon className="mb-3 h-6 w-6 text-peanut" />
                <h3 className="mb-1 font-semibold text-gray-900">Our Vision</h3>
                <p className="text-sm text-gray-600">{settings["about.vision"]}</p>
              </div>
            </div>

            <Link
              href="/shop"
              className="mt-8 inline-flex items-center gap-2 font-semibold text-peanut transition-all hover:gap-3"
            >
              Explore our products
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </Reveal>

          <Reveal from="right" duration={700} className="relative">
            <div className="aspect-[6/7] overflow-hidden rounded-3xl bg-beige/40 shadow-xl">
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-beige to-cream">
                <span className="px-8 text-center text-sm font-medium text-roasted/40">
                  Small-batch roasting, every morning
                </span>
              </div>
            </div>
            {years !== null && (
              <div className="absolute bottom-4 left-4 rounded-2xl bg-white/80 p-5 shadow-xl backdrop-blur-md lg:-bottom-6 lg:-left-6">
                <HeartIcon className="mb-2 h-6 w-6 text-peanut" />
                <p className="text-sm font-semibold text-gray-900">{years}+ Years</p>
                <p className="text-xs text-gray-500">of peanut expertise</p>
              </div>
            )}
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ testimonials */

function TestimonialsSection({ testimonials }: { testimonials: Testimonial[] }) {
  if (testimonials.length === 0) return null;

  // The track renders the list twice so the -50% keyframe lands exactly where
  // it began, making the loop seamless. The duplicate is hidden from screen
  // readers so the same quotes are not announced twice.
  return (
    <section className="overflow-hidden bg-beige/30 py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-12 text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-peanut">
            Customer Love
          </span>
          <h2 className="mt-2 text-3xl font-bold text-gray-900 sm:text-4xl">
            What Our Customers Say
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-gray-600">
            Don&rsquo;t just take our word for it — hear from our happy customers.
          </p>
        </Reveal>
      </div>

      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-[#f4ead6] to-transparent sm:w-32" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[#f4ead6] to-transparent sm:w-32" />

        <div className="overflow-hidden">
          <div className="flex w-max gap-6 animate-marquee">
            {[0, 1].map((copy) => (
              <div
                key={copy}
                className="flex gap-6"
                aria-hidden={copy === 1 ? true : undefined}
              >
                {testimonials.map((t) => (
                  <TestimonialCard key={`${copy}-${t.id}`} t={t} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TestimonialCard({ t }: { t: Testimonial }) {
  return (
    <figure className="w-[80vw] shrink-0 rounded-2xl bg-white/70 p-5 shadow-lg backdrop-blur-md sm:w-[320px]">
      <QuoteIcon className="mb-3 h-5 w-5 text-peanut/40" />
      <blockquote className="text-sm italic leading-relaxed text-gray-700">
        &ldquo;{t.text}&rdquo;
      </blockquote>
      <Stars rating={t.rating} className="mt-4" />
      <figcaption className="mt-4 flex items-center gap-3 border-t border-peanut/10 pt-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-beige text-xs font-semibold text-roasted">
          {t.name
            .split(" ")
            .map((w) => w[0])
            .slice(0, 2)
            .join("")}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-gray-900">
            {t.name}
          </span>
          {t.role && <span className="block text-xs text-gray-500">{t.role}</span>}
        </span>
      </figcaption>
    </figure>
  );
}

/* ----------------------------------------------------------------- contact */ 

function ContactSection({ settings }: { settings: Record<string, string> }) {
  return (
    <section className="bg-white py-16 lg:py-24">
      <Reveal className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
        <span className="text-sm font-semibold uppercase tracking-wider text-peanut">
          Contact Info
        </span>
        <h2 className="mt-2 text-3xl font-bold text-gray-900 sm:text-4xl">
          Get In Touch
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-gray-600">
          {settings["order.support_note"]}
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          {settings["contact.phone"] && (
            <a
              href={`tel:${settings["contact.phone_e164"] ?? settings["contact.phone"]}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-peanut px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-roasted sm:w-auto"
            >
              {settings["contact.phone"]}
            </a>
          )}
          {settings["contact.email"] && (
            <a
              href={`mailto:${settings["contact.email"]}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-gray-300 px-7 py-3.5 text-sm font-semibold text-gray-700 transition-colors hover:border-peanut hover:text-peanut sm:w-auto"
            >
              Email us
            </a>
          )}
        </div>
      </Reveal>
    </section>
  );
}
