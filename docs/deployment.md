# Deployment

The application needs two things: somewhere to run Node, and a Postgres
database. It is a standard Next.js app with no other infrastructure — no Redis,
no queue, no object storage.

## Vercel + Neon (recommended)

Vercel hosts the app; Neon provides Postgres. Both have free tiers that
comfortably fit this workload, and Neon is available directly from the Vercel
dashboard.

1. **Create the database.** In your Vercel project: *Storage → Create Database
   → Neon*. Vercel sets `DATABASE_URL` for you. Use the **pooled** connection
   string if offered both.
2. **Set the remaining environment variables** under *Settings → Environment
   Variables*:

   | Variable | Value |
   | --- | --- |
   | `AUTH_SECRET` | 48+ random characters. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
   | `SESSION_MAX_AGE` | `604800` (7 days) — optional |
   | `DEFAULT_FX_GBP_USD` | `1.33` — optional |

3. **Deploy.** Import the repository and let Vercel build it.
4. **The schema creates itself on deploy.** The `vercel-build` script runs
   `db:setup` before `next build`, which applies migrations and — only if the
   database has no users — seeds reference data and the starting stock. Both
   halves are safe to repeat: migrations are tracked in a ledger, and seeding
   is skipped entirely once any user exists, so a later deploy can never
   re-seed or overwrite live data.

   To provision manually instead, run the same steps from your machine with
   `DATABASE_URL` in `.env`:

   ```bash
   npm run db:migrate   # create the tables
   npm run db:seed      # reference data, demo users, the 26 watches
   ```

   Once the system is established and you would rather migrations be a
   deliberate act, delete the `vercel-build` script from `package.json` and run
   `npm run db:migrate` yourself as part of your release process.

5. **Check it.** Visit `/api/health`. It reports connectivity and whether
   migrations have run, separately — so a misconfigured deployment tells you
   which of the two is wrong.
6. **Change the seeded passwords immediately.** Sign in as
   `alex@bluecroft.co.uk` / `Bluecroft2026!`, then use *Settings → Users* to
   set real passwords and remove any demo accounts you do not need.

### Notes for serverless

- Always use a **pooled** Postgres endpoint. Each serverless instance opens its
  own pool; a direct connection string will exhaust the connection limit under
  even light concurrency.
- `DATABASE_POOL_MAX` defaults to 5 per instance, which suits Neon's pooler.
- Rate limiting is in-process, so limits apply per instance rather than
  globally. For a team of this size that is fine; a shared store would be the
  change if it ever is not (`src/server/auth/rate-limit.ts`).

## Alternatives

| Host | When it fits |
| --- | --- |
| **Vercel + Neon** | Default. Zero server management, deploys on git push. |
| **Railway / Render** | App and Postgres in one place, a persistent disk, and a normal always-on Node process. Simpler mental model, small monthly cost. |
| **Fly.io** | If you want the app close to Dubai for latency, or a persistent volume. |
| **Your own VPS** | `npm run build && npm start` behind nginx, with Postgres on the same box. Most control, most maintenance. |

Anything that runs Node 20+ and reaches a Postgres database will work; nothing
in the codebase is Vercel-specific.

## Backups

Whichever host you choose, **turn on automated database backups**. This is the
only copy of your stock records once the spreadsheet is retired. Neon and
Railway both offer point-in-time restore; enable it before you start entering
real data.

## Going live checklist

- [ ] `AUTH_SECRET` set to a long random value, different from any example
- [ ] `DATABASE_URL` points at a pooled endpoint
- [ ] Migrations applied (`/api/health` reports `ok`, not `unmigrated`)
- [ ] Seeded demo passwords changed; unused demo accounts removed
- [ ] Automated backups enabled
- [ ] A real owner account created, and the seeded one removed or secured
