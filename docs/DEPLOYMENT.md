# GeoFlow Lab deployment

This application is a Next.js web service backed by Supabase and a separate Python calculation worker. The checked-in Render blueprint defines one Node web service and one Docker worker. The worker is responsible for processing queued immutable runs; the web service owns authentication, API requests, and signed download URLs.

## Local setup

Requirements are Node 22 or newer and pnpm 11.19.0. The checked-in Render web service uses Node 22; local development may use the installed Node 24.19.0. The worker image requires Python dependencies from `worker/requirements.txt` and LibreOffice in the worker image.

```text
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Copy `.env.example` to `.env.local` and fill in the values described below. Never commit `.env.local`, service-role keys, Stripe secrets, database URLs, or OAuth client secrets.

## Environment variables

The browser can receive only variables prefixed with `NEXT_PUBLIC_`. These are identifiers, not credentials:

| Variable                        | Owner         | Purpose                                                                                   |
| ------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Browser       | Supabase project URL.                                                                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser       | Supabase publishable/anon key.                                                            |
| `APP_URL`                       | Server        | Canonical public origin used for auth redirects, checkout return URLs, and origin checks. |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server only   | Service-role database/storage operations. Never expose to the browser.                    |
| `SUPABASE_URL`                  | Server/worker | Supabase URL for trusted server and worker calls.                                         |
| `DATABASE_URL`                  | Worker/server | Postgres connection used by the worker.                                                   |
| `STRIPE_SECRET_KEY`             | Server only   | Stripe API access.                                                                        |
| `STRIPE_WEBHOOK_SECRET`         | Server only   | Signature verification for `/api/billing/webhook`.                                        |
| `STRIPE_MONTHLY_PRICE_ID`       | Server        | Stripe price for the monthly CAD plan.                                                    |
| `STRIPE_ANNUAL_PRICE_ID`        | Server        | Stripe price for the annual CAD plan.                                                     |
| `BILLING_ENABLED`               | Server        | Keep `false` until live prices, webhook handling, and launch approval are complete.       |
| `SOFFICE_BIN`                   | Worker        | LibreOffice executable; default `soffice`.                                                |

Do not put `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, Stripe secrets, or worker credentials in any `NEXT_PUBLIC_` variable.

## Supabase

Create a Supabase project, enable Google OAuth and email magic links, and add these redirect URLs in Supabase Auth:

```text
http://localhost:3000/auth/callback
https://<your-app-domain>/auth/callback
```

Configure the Google provider with its OAuth client in the Supabase dashboard. Configure email delivery before relying on magic links in production.

Apply migrations from the repository root with the project migration runner. This uses `DATABASE_URL` and maintains the immutable checksum ledger; the project does not include Supabase CLI configuration:

```text
python scripts/migrate.py
```

The migrations create immutable calculator versions, user-owned calculations/runs, worker jobs, subscriptions, billing event guards, checkout leases, and the private storage buckets used for templates and exports. The production database must use the committed migrations in order; do not edit an approved calculator version in place.

## Registering a model version

The original source workbook is preserved outside this repository at `<owner-source-workbook.xlsx>`. The checked-in `private/models/state-rent/1.0.0-candidate.1.xlsx` is the modified runtime candidate. Never pass the runtime candidate to `worker/prepare_model.py` as its source. If the owner must regenerate a candidate, use the original workbook as the source and write to the runtime destination:

```text
python worker/prepare_model.py "<owner-source-workbook.xlsx>" \
  --target private/models/state-rent/1.0.0-candidate.1.xlsx \
  --manifest models/state-rent/1.0.0-candidate.1.json
```

Register the existing runtime candidate with the owner-only registration script. It verifies the runtime SHA-256 against the manifest, uploads the private template, and inserts an immutable review candidate with `approved=false`:

```text
python scripts/register_model.py \
  --manifest models/state-rent/1.0.0-candidate.1.json \
  --template private/models/state-rent/1.0.0-candidate.1.xlsx
```

The command requires `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. A run is rejected by the database when its calculator version is not approved.

The public preview manifest is generated separately with:

```text
node scripts/generate-preview-manifest.mjs
```

That allowlisted artifact contains all 318 input fields and display/validation metadata only. It does not expose source/runtime hashes, repairs, formulas, paths, or review metadata.

## Render

The checked-in `render.yaml` provisions:

- `geoflow-lab-web`: Node 22, `pnpm build`, `pnpm start`, health check `/api/health`.
- `geoflow-lab-calculations`: the Docker worker from `worker/Dockerfile`; `SOFFICE_BIN` is used by the worker's LibreOffice conversion path.

Create the Render services from the blueprint, set all `sync: false` values in the Render dashboard, and set `APP_URL` to the final HTTPS origin. Keep `BILLING_ENABLED=false` until the launch gates below are complete. Confirm the web service binds through the provided start command and that the worker can reach the same Supabase/Postgres project.

## Stripe

Create two recurring Stripe Prices in CAD: monthly CAD $49.99 and annual CAD $499.99. Put only their Price IDs in `STRIPE_MONTHLY_PRICE_ID` and `STRIPE_ANNUAL_PRICE_ID`. Configure the webhook endpoint:

```text
https://<your-app-domain>/api/billing/webhook
```

The server keeps checkout idempotent through the database checkout lease and applies subscription state from verified webhook events. Leave checkout disabled when Stripe is not configured.

## Approval checklist

Deployment is not a model approval. Before setting a version `approved=true` or enabling billing, record these checks:

- [ ] Numerical approval review, including the 12/15 checkpoint, is complete and signed off by the model owner.
- [ ] The candidate worker output has been reviewed against the source workbook.
- [ ] No approved Excel parity claim has been made; Excel parity remains unapproved until explicitly validated.
- [ ] The 30-year schedule, NPV rate labels, payout logic, and repaired workbook dependencies have been reviewed.
- [ ] The exact source/runtime SHA-256 values and immutable version row are recorded.
- [ ] Worker queue processing, retries, leases, and immutable run behavior have been exercised against the deployment database.
- [ ] Google OAuth and email magic-link redirects work on the final HTTPS origin.
- [ ] Stripe test checkout and signed webhook delivery have been verified before live prices are used.
- [ ] `BILLING_ENABLED` is changed to `true` only after the above checks and live Price IDs are configured.

The Docker worker and full Render deployment are not tested by the local Next.js typecheck/build alone. Validate them in a staging environment before production rollout. The original source workbook remains preserved at its owner workstation path; release preparation reads that source and writes the separate private runtime candidate.

## Official references

- [Next.js environment variables](https://nextjs.org/docs/pages/guides/environment-variables)
- [Render web services](https://render.com/docs/web-services)
- [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase passwordless email](https://supabase.com/docs/guides/auth/passwordless-login/auth-magic-link)
- [Stripe Checkout quickstart](https://docs.stripe.com/payments/checkout/quickstarts)
- [Stripe Checkout Sessions API](https://docs.stripe.com/api/checkout/sessions)
