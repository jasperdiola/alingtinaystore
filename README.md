This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Continuous integration and deployment

`.github/workflows/ci.yml` runs on every branch. Only `main` deploys.

| Job | Runs on | What it does |
| --- | --- | --- |
| **verify** | every branch, every PR | `prisma generate`, `tsc --noEmit`, `eslint`, `next build` |
| **regression** | every branch, every PR | database reachability, the 13 `db:*-check` suites, then the render and client-bundle checks against the build from `verify` |
| **deploy** | pushes to `main` only | `vercel pull / build / deploy --prod`, then a smoke test of the live URL |

`deploy` requires `regression`, which requires `verify` — a red test never ships.

### Two things to know before enabling it

**The suites write to the production database.** They create orders, move stock
and edit prices, restoring everything in a `finally` block. There is no staging
database, so the `regression` job is pinned to a `production-database`
concurrency group: runs from every branch queue behind one another rather than
interleaving their writes, and are never cancelled — a suite killed mid-run
never reaches its cleanup. If this project grows past one developer, a second
Supabase project for CI is the fix.

**Turn off Vercel's own Git integration.** If Vercel is connected to this repo
*and* this workflow deploys, every push deploys twice, and Vercel's copy skips
the tests entirely. In the Vercel dashboard: Settings → Git → disconnect, or set
Ignored Build Step to `exit 0`.

### Setting it up

```bash
npx vercel link          # creates .vercel/project.json with the org and project ids
npm run ci:secrets       # prints every GitHub secret to create, with values from .env
npm run ci:secrets -- --names   # names only — safe to share
```

Add each at **Settings → Secrets and variables → Actions**.

GitHub's secrets configure *CI*: they let the workflow reach the database and
deploy on your behalf. They do **not** configure the running app — `vercel pull`
reads that from Vercel's own environment variables, so the same values must also
exist in **Vercel → Settings → Environment Variables** for the deployed site to
work.

### Running the same checks locally

```bash
npm run verify:db              # all 13 database suites, with a summary
npm run check:render           # builds, then renders and inspects the bundle
npm run check:render:prebuilt  # same, reusing an existing .next
```
