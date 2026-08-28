import type { NextConfig } from "next";

/**
 * Product images are served from the public Supabase Storage bucket, so
 * next/image needs that host allow-listed — without it every uploaded image
 * throws at render rather than merely failing to load.
 *
 * The host is derived from NEXT_PUBLIC_SUPABASE_URL instead of being hardcoded,
 * so a different Supabase project (staging, a fork) works without editing this
 * file. next.config is evaluated in Node at build time, so reading env here is
 * fine.
 */
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      ...(supabaseHost
        ? [
            {
              protocol: "https" as const,
              hostname: supabaseHost,
              pathname: "/storage/v1/object/public/**",
            },
          ]
        : []),
      // Seed data still points at these placeholders for products that have
      // never had a real image uploaded.
      { protocol: "https" as const, hostname: "placehold.co" },
    ],
  },
};

export default nextConfig;
