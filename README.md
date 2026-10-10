# Vshow

Campus digital signage media approval platform (React Router framework mode, SSR, Tailwind CSS).
Product and data-model specs live in [docs/](docs/).

## First-time setup

Prerequisites: **Node >= 22.22** (`nvm use` / `fnm use` reads `.nvmrc`), npm, and — for the local database — **Docker with Compose v2**.

```bash
npm install
npm run setup        # creates .env, generates secrets, validates tools (safe to re-run)
npm run db:up        # local Postgres on 127.0.0.1 (skip if using Neon)
npm run dev          # http://localhost:5173
```

`npm run setup` never overwrites existing values in `.env`; it only fills missing or `change-me` placeholders. It never prints secrets or full connection strings. `npm run setup:check` validates without writing.

### Choosing a database

The target is explicit via `DB_TARGET` in `.env`:

- **local** (default): Docker Compose Postgres 16, bound to `127.0.0.1` only. Credentials are generated into `.env`.
- **neon**: `npm run setup -- --db=neon`, then paste your Neon connection string into `DATABASE_URL` (include `?sslmode=require`). Docker is not required. Use a dedicated Neon branch for development, never the production branch.

To switch an existing `.env`, edit `DB_TARGET` by hand; setup will not do it for you.

### Service commands

| Command | Effect |
| --- | --- |
| `npm run db:up` | Start local Postgres (waits until healthy) |
| `npm run db:down` | Stop and remove the container; **data is kept** in the Docker volume |
| `npm run db:reset:local` | **Deletes local data.** Requires typing the database name; refuses unless `DB_TARGET=local` and `DATABASE_URL` is the local compose database. Non-interactive: `-- --confirm=<db name>` |

Reset recreates an empty database; it does not run migrations or seeds.

## Database and migrations

Schema source of truth: [app/db/schema/](app/db/schema/) (Drizzle, mirrors [docs/Vshow_Database_Schema_v1.1.md](docs/Vshow_Database_Schema_v1.1.md)). Generated SQL is committed in [drizzle/](drizzle/) and is **forward-only history: never edit or delete a migration that has been applied anywhere** � add a new one instead.

| Command | Effect |
| --- | --- |
| `npm run db:generate` | Generate a new migration file from schema changes (no database access). Review the SQL, then commit it |
| `npm run db:check` | Verify migration files are internally consistent |
| `npm run db:migrate` | Apply pending migrations to the database in `.env`. Explicit only: never run by dev, build or app start |
| `npm run db:migrate -- --dry-run` | Show pending migrations, change nothing |
| `npm run db:health` | Connect and run read-only queries; reports server version and applied/pending migrations (`-- --direct` tests the migration connection) |
| `npm test` | Config validation, migration drift check, and (if local Postgres is up) an integration test that migrates a throwaway database and drops it |

Safety rules built into `db:migrate`: `DB_TARGET` must be set; a `local` target must be a loopback host and a `neon` target a `*.neon.tech` host; non-local targets additionally require `--confirm-host=<exact host>`; pooled Neon URLs are refused; migrations containing `DROP TABLE/COLUMN/SCHEMA`, `TRUNCATE` or `DELETE FROM` need `--allow-destructive`; a modified/missing already-applied migration aborts. There is no `drizzle-kit push`/`studio` script and `drizzle.config.ts` holds no credentials.

### Environments

Each environment has its own database and its own `DATABASE_URL`; migrate each one **independently and deliberately**, from a trusted machine or a manual CI job, never automatically on deploy.

- **Development (local):** `npm run db:up && npm run db:migrate`.
- **Test:** `npm test` uses a throwaway database on local Postgres. CI uses a service container.
- **Preview:** use a Neon branch per preview (or a shared `preview` branch), never the production branch. Migrate it with its direct URL before testing.
- **Production:** take a Neon restore point/branch first, run `db:migrate -- --dry-run`, review, then `db:migrate -- --confirm-host=<host>` with the production **direct** URL supplied via the shell environment (not a committed file). Roll forward with a new migration if something is wrong.

Neon: set `DB_TARGET=neon`, `DATABASE_URL` to the **pooled** (`-pooler`) string for the app, and `DATABASE_URL_DIRECT` to the direct string for migrations. The app uses `pg` (node-postgres) on the Node.js runtime with a small per-instance pool; it is not compatible with the Edge runtime.

## Security notes

- `.env` and `.env.*` are git-ignored and excluded from Docker build contexts; only `.env.example` (placeholders) is tracked.
- On Windows, file permissions are not restricted by setup (POSIX gets `0600`). Keep the repo in your user profile.
- If you change `POSTGRES_PASSWORD` after the first `db:up`, the existing volume keeps the old password; run `npm run db:reset:local` or change it inside Postgres.
- Platforms: Windows, macOS and Linux are supported through Node scripts (no shell dependencies). Tested on Windows only.

## Build and deploy

```bash
npm run typecheck
npm run build
npm run start
```

The included `Dockerfile` builds a self-hosted image; the intended production target is Vercel (not configured yet).
