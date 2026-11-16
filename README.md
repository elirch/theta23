# Theta23 — Space Mission Readiness Radar

> Which components and dependencies around the world threaten my mission's next milestone — and how much schedule margin remains?

Theta23 is a map-first supply-chain readiness tool for one fictional satellite mission, **KESTREL-1 — Earth Observation Demonstrator**. Select a supplier or transport disruption and it shows which components become late, how their readiness dates move, which milestone loses margin, whether an original date is missed, and whether downstream timing can be calculated or is unresolved.

This is Phase 1. It replaces the earlier Theta23 financial application entirely.

**All suppliers, part numbers, routes and mission arrangements are illustrative.** Geography is real; the business entities are fictional.

## What is in Phase 1

- One mission, three ordered milestones, ten components, ten locations, six planned routes
- Interactive SVG world map (pan, zoom, node and route selection) with bundled geometry — no map API key
- Three predefined disruption scenarios plus a custom delay scenario
- Deterministic readiness and schedule-margin engine with plain-language explanations
- Component ledger with filtering, sorting, manual editing and atomic CSV import
- Milestone editor (dates, alternative dates, dependency intervals, analysis date)
- Lightweight action log per component

## Stack

Next.js 16 (App Router) · React 19 · strict TypeScript · Tailwind CSS 4 · lucide-react · Supabase PostgreSQL via `pg` · Papa Parse · Vitest + PGlite (embedded PostgreSQL for tests).

```
src/lib/        pure domain code: dates, schedule engine, explanations, validation, CSV, seed
src/server/     database port, repository (SQL), owner auth, server actions
src/components/ the workspace UI (map, impact panel, milestone strip, ledger, drawer, editors)
supabase/migrations/   SQL for the dedicated theta23_space schema
scripts/        migrate, seed, map-geometry and sample-CSV generators
tests/          engine, CSV, persistence and authorization tests
public/sample-components.csv
```

## Local development

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # fill in values, see below
npm run db:migrate           # creates the theta23_space schema (idempotent)
npm run db:seed              # loads the demo dataset once; never overwrites
npm run dev
```

Without `DATABASE_URL` the app still runs: it serves the bundled demo dataset read-only, and edits live in a browser-only sandbox.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase PostgreSQL connection string. On Vercel use the **Transaction pooler** URI. Server-side only. |
| `DATABASE_CA_CERT` | Optional. Supabase CA certificate (PEM). When set, the TLS certificate is fully verified. |
| `OWNER_PASSWORD` | Password for owner sign-in. Checked server-side only. |
| `SESSION_SECRET` | 32+ random characters used to sign the owner session cookie (`openssl rand -hex 32`). |

Checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Deployment (Vercel + Supabase)

1. **Database.** Apply `supabase/migrations/0001_theta23_space.sql` — either paste it into the Supabase SQL editor, or run `DATABASE_URL=… npm run db:migrate`. It creates only the `theta23_space` schema and does not read or change anything in `public`.
2. **Environment variables.** In the Vercel project set `DATABASE_URL`, `OWNER_PASSWORD` and `SESSION_SECRET` (and optionally `DATABASE_CA_CERT`). Set them for **Production only** unless you deliberately want Preview deployments to write to the same database.
3. **Seed.** Run `DATABASE_URL=… npm run db:seed`, or sign in as owner on the deployed site and use **Reset Demo Data**.
4. **Deploy.** Push the branch for a Preview deployment; merge to `main` for Production. `vercel.json` pins the framework to Next.js and no longer declares any cron job.

A Preview deployment without `DATABASE_URL` is fully usable in sandbox mode and cannot touch any database.

## Access model

- **Visitors** can read everything and explore scenarios. Their edits (components, CSV import, milestone dates, action records) are applied in the browser tab only — a sandbox — and are never sent to the server.
- **The owner** signs in with `OWNER_PASSWORD`. Only then are edits, imports, action records and Reset Demo Data persisted.
- Every write is a server action that verifies the signed, httpOnly session cookie before touching the database. The server re-validates all input, including re-parsing uploaded CSV.
- The database is reached only from the server over a direct PostgreSQL connection. No Supabase key is shipped to the browser. The `theta23_space` tables have row-level security enabled with no policies and all privileges revoked from the `anon` and `authenticated` roles, so the Supabase Data API cannot read or write them.

## Scheduling assumptions

All dates are date-only values handled as whole calendar days in UTC. The analysis date is stored with the mission and shown in the header; nothing reads the wall clock.

**Components**

- Adjusted arrival = baseline arrival + scenario delay (if the scenario targets the component's supplier location or route)
- Readiness = adjusted arrival + preparation days (inspection, installation, verification)
- Margin = the assigned milestone's **original** scheduled date − readiness
- Status: more than 7 days → WITHIN PLAN · 0 to 7 → TIGHT MARGIN · below 0 → PROJECTED MISS · missing inputs → UNKNOWN
- The 7-day threshold is a demo planning convention, not an industry standard
- If the milestone has a known alternative date, the alternative-plan margin is shown separately; the original margin is never replaced
- Single-source status adds no delay. Only the scenario assumption does

**Milestones**

- Earliest readiness = the latest of (a) readiness of the directly assigned components and (b) the preceding milestone's planned occurrence + this milestone's minimum interval
- The minimum interval **includes the preceding campaign's own duration and follow-on preparation**. For example, 12 days after the environmental test *start* covers the test campaign and post-test work. A test start date is never treated as proof that testing is complete
- Ready on or before the scheduled date → the milestone occurs on its scheduled date, and that date propagates downstream
- Ready after the scheduled date → the original commitment is a PROJECTED MISS. If a known alternative date is on or after readiness, downstream planning uses it (the original miss stays visible). Otherwise downstream timing is **UNRESOLVED** — a missed milestone is not assumed to happen the next day
- A milestone behind an unresolved predecessor is never shown as safe. The app reports a lower bound ("no earlier than…"), and if a known dependency already proves a miss, that breach is shown alongside the unresolved state
- All limiting dependencies are listed, including ties

**Interpretation limits**

- Schedule margin is not a decision deadline; that would require mitigation lead times, which the model does not hold
- The Launch Integration Cutoff is not the launch date. Nothing here estimates launch delay, cancellation or cost
- A route is a planned physical path, not a verified freight service
- This is a simplified dependency model, not a full engineering schedule

**Worked example** (the fixture in `tests/schedule.test.ts`, and Scenario A in the app): flight computer arrives June 1, 2027, preparation 10 days, environmental test June 20 → ready June 11, margin +9, WITHIN PLAN. With a 14-day supplier delay → arrives June 15, ready June 25, margin −5, PROJECTED MISS; launch integration timing is unresolved. Enter an alternative test start of July 2 (interval 12 days, cutoff July 20) → launch integration ready July 14, margin +6, TIGHT MARGIN, with the June 20 miss still shown.

## Seed data

Fixed dates around the initial analysis date of 2027-04-12. They are written once by `db:seed` (or by Reset Demo Data) and never shifted at startup.

| Scenario | Target | Delay | Result |
| --- | --- | --- | --- |
| A · Supplier production delay | Toulouse supplier location | +14 d | KS-FC-101 misses the test by 5 days |
| B · Transport corridor disruption | Route RT-NGO-ABQ (trans-Pacific) | +8 d | Both components on the route move; KS-XT-505 misses by 2 days |
| C · Single-source component delay | Munich supplier location | +21 d | KS-ST-202 misses by 10 days |

## CSV import

Columns: `partNumber, description, subsystem, supplierLocationCode, supplierName, routeCode, milestoneCode, baselineArrivalDate, preparationDays, isSingleSource, notes`

- Download the sample from the ledger (`public/sample-components.csv`, ten fictional components)
- Rows are upserted by mission and part number; the preview states which rows will be created or updated
- Validation is all-or-nothing, with line- and column-specific errors: required fields, ISO dates, whole non-negative preparation days, booleans, unknown location/route/milestone codes (with the valid options), duplicate part numbers in one file, and routes that do not start at the supplier location
- Re-importing the same file changes nothing and creates no duplicates

## Known limitations

- One mission; one directly assigned milestone per component; locations, routes and predefined scenarios are seed data without an editor
- Scenarios (including custom ones) are exploratory and are not saved; one scenario is active at a time
- Owner access is a single shared password with a 12-hour session; there is no rate limiting beyond a short delay on failed sign-in
- The action log is an ordinary editable log, not an audit trail
- The map uses 1:110m geometry in an equirectangular projection: fine for a world overview, coarse when zoomed far in
- Without `DATABASE_CA_CERT` the database connection is encrypted but the server certificate is not verified

## What was removed from the old application

The previous Theta23 was a static page plus Vercel serverless functions for market and geopolitical-finance signals. All of it is gone from the codebase:

- `index.html`, `admin.html` — market dashboards, commodities/macro signals, weekly reports, and a browser-side password gate
- `api/quotes.js` — Yahoo Finance quote proxy
- `api/agent-scan.js`, `agent-archive.js`, `agent-report.js`, `agent-macro.js`, `agent-commodities.js`, `agent-run-all.js` — scheduled agents that read news feeds, called the Anthropic API and wrote to Supabase
- The daily Vercel cron (`/api/agent-run-all`) in `vercel.json`
- Browser calls to Polygon.io and to Supabase REST with a publishable key

The final state of the old application is preserved at commit `811a871` (tag `legacy-finance-app-final`).

### Cleanup that must be done outside this repository

These could not be done from the codebase and are **not** claimed as done:

1. **Vercel environment variables** — remove `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY` and `AGENT_SECRET` from the project once the new version is in production. If the Anthropic key is used by nothing else, revoke it in the Anthropic console; removing code does not stop a subscription or billing.
2. **Rotate exposed secrets** — the old pages and git history contain a Polygon.io API key, the agent trigger secret and the admin password in plain text. Treat them as compromised: rotate or delete the Polygon key and do not reuse the others.
3. **Legacy Supabase tables** — `geo_events`, `macro_events`, `commodities`, `reports` and `agent_queue` in `public` are left untouched and dormant. The old admin page wrote to them from the browser with the publishable key, which means their row-level security allows anonymous writes. Tighten those policies or archive and drop the tables when you are ready. Also check Supabase for `pg_cron` jobs or database webhooks; none are defined in this repository.
4. **Vercel cron** — it is removed from `vercel.json` and stops when this version is deployed to production. Confirm under Project → Settings → Cron Jobs.

## Future ideas (not built)

Multiple missions; mitigation lead times and true decision deadlines; components feeding several milestones; saved scenario comparisons; editable locations and routes; per-user accounts.

## Attribution

Map geometry: [Natural Earth](https://www.naturalearthdata.com/) (public domain) via the `world-atlas` package, pre-projected by `scripts/build-map.mjs`.
