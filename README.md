# Vshow

Campus digital signage media approval platform: committees submit media, Corporate Communication reviews it, and the Server Room Manager hands approved media to the signage software. Built with React Router (framework mode, SSR), TypeScript, Tailwind CSS, Drizzle ORM and PostgreSQL. Product and data-model specs are in [docs/](docs/).

## Quick start (clone to running app)

Each step is a separate, explicit command. Nothing migrates or seeds automatically.

```bash
git clone <repo-url> && cd vshow
nvm use                 # or fnm use / install Node 24.x (see .nvmrc)
npm ci                  # install exactly what package-lock.json specifies
npm run setup           # create .env, generate secrets, validate tools (safe to re-run)
npm run db:up           # start local PostgreSQL in Docker (127.0.0.1 only)
npm run db:migrate      # create the schema (explicit, never automatic)
npm run db:seed         # OPTIONAL: synthetic development data
npm run dev             # http://localhost:5173
```

Check the database any time with `npm run db:health`.

### Prerequisites

| Tool                                               | Needed for                              |
| -------------------------------------------------- | --------------------------------------- |
| Node.js 24.x and npm 11.8.0 (`packageManager`)     | everything                              |
| Docker with Compose v2 (Docker Desktop on Win/Mac) | local PostgreSQL (not needed with Neon) |
| Git                                                | cloning                                 |

`npm run setup` verifies these and prints a fix for anything missing. Windows, macOS and Linux are supported through Node scripts with no shell dependencies; CI runs on Linux and most development so far has been on Windows.

## Configuration

`npm run setup` creates `.env` from [.env.example](.env.example). It fills only missing or `change-me` values, so re-running never overwrites your settings, and it never prints secrets or full connection strings. `npm run setup:check` validates without writing.

| Variable                                | Purpose                                                     |
| --------------------------------------- | ----------------------------------------------------------- |
| `APP_ENV`                               | `development` or `test`. Seeding refuses anything else      |
| `DB_TARGET`                             | `local` (Docker) or `neon`. Always explicit                 |
| `POSTGRES_*`                            | Local container credentials (password generated)            |
| `DATABASE_URL`                          | Runtime connection. Neon: the **pooled** (`-pooler`) string |
| `DATABASE_URL_DIRECT`                   | Neon only: **direct** string used by `db:migrate`           |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Reserved for the upcoming auth phase (secret is generated)  |

`.env` and `.env.*` are git-ignored (only `.env.example` is tracked) and excluded from Docker build contexts.

## Database

### Local PostgreSQL (default)

| Command                  | Effect                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `npm run db:up`          | Start Postgres 16 bound to `127.0.0.1`, wait until healthy                               |
| `npm run db:down`        | Stop and remove the container; **data is kept** in the Docker volume                     |
| `npm run db:reset:local` | **Deletes all local data.** Type the database name to confirm; refuses non-local targets |

### Neon (optional, for development only)

```bash
npm run setup -- --db=neon     # then edit .env:
#   DATABASE_URL=<pooled Neon string>          (host contains -pooler, ?sslmode=require)
#   DATABASE_URL_DIRECT=<direct Neon string>   (used for migrations)
```

Use a dedicated Neon **branch** for development, never the production branch. Docker is not required. Seeding is **local-only** and refuses Neon targets. Applying migrations to a remote database needs `--confirm-host=<exact host>` (see below).

### Migrations

Schema source: [app/db/schema/](app/db/schema/) (mirrors [docs/Vshow_Database_Schema_v1.1.md](docs/Vshow_Database_Schema_v1.1.md)). Generated SQL lives in [drizzle/](drizzle/) and is **forward-only history: never edit or delete a migration that has been applied anywhere**; add a new one instead.

| Command                           | Effect                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run db:generate`             | Generate a migration from schema changes (no DB access). Review the SQL, then commit it                 |
| `npm run db:check`                | Verify migration files are consistent                                                                   |
| `npm run db:migrate`              | Apply pending migrations to the database in `.env`                                                      |
| `npm run db:migrate -- --dry-run` | Show what would be applied; change nothing                                                              |
| `npm run db:health`               | Connect, run read-only queries, report applied/pending migrations (`-- --direct` for the migration URL) |

`db:migrate` safety rules: `DB_TARGET` must be set; a `neon` target must be a `*.neon.tech` host; a `local` target must pass the **shared local-target guard** (below); non-local targets also need `--confirm-host=<exact host>`; pooled Neon URLs are refused; migrations with `DROP TABLE/COLUMN/SCHEMA`, `TRUNCATE` or `DELETE FROM` need `--allow-destructive`; a modified or missing already-applied migration aborts; a lock prevents concurrent runs. There is no `drizzle-kit push`/`studio` script and `drizzle.config.ts` holds no credentials.

**Per environment** (migrate each database independently and deliberately, never on deploy):

- **Development:** `npm run db:up && npm run db:migrate`.
- **Test:** `npm run test:ci` migrates a throwaway database on local Postgres; CI uses a service container.
- **Preview:** a Neon branch per preview (never the production branch); migrate with its direct URL first.
- **Production:** take a Neon restore point, run `db:migrate -- --dry-run`, review, then `db:migrate -- --confirm-host=<host>` with the production **direct** URL provided through the shell environment, not a file. Fix problems by rolling forward with a new migration.

### Local-target guard (migrate, seed, reset)

A loopback address alone is **not** trusted: an SSH tunnel or port-forward to a real database also looks like `127.0.0.1`. Every command that writes to a local database (`db:migrate` on a local target, `db:seed`, `db:reset:local`) uses one shared guard, [scripts/lib/local-target.ts](scripts/lib/local-target.ts), which requires all of:

- `DB_TARGET=local`, and `APP_ENV` unset or `development`/`test` (seeding requires it to be set); no `NODE_ENV=production` or Vercel markers.
- Host exactly `127.0.0.1` or `localhost`; port equal to `POSTGRES_PORT` (default 5432); user equal to `POSTGRES_USER`; database equal to `POSTGRES_DB` (default `vshow`). Under `APP_ENV=test` only, throwaway `vshow_test_*` databases are also allowed.
- Production-like names (`prod`, `live`, `staging`, `preview`) are refused even if `POSTGRES_DB` is set to match.
- `DATABASE_URL` and `DATABASE_URL_DIRECT`, if both set, must describe the same database, and a shell variable must not silently override a different value in `.env`.

Anything it cannot classify is refused. Remote (Neon) migrations are unchanged: they need `--confirm-host=<exact host>`; there is no remote seed or reset. Residual risk: a tunnel deliberately opened on the Compose port with the same database name would look local; do not do that.

### Seed data (development only)

`npm run db:seed` inserts synthetic fixtures: 7 submissions across 2 committees (draft, pending, approved awaiting handoff, rejected, revised after feedback, replaced after approval, scheduled) and 8 users covering role and membership boundaries. All fixtures are marked `[SEED]` / `SEED-*` / `@seed.vshow.invalid`; media object keys (`seed/...`) do not exist in object storage.

It is idempotent (insert-if-missing, never updates), runs in one transaction, and requires `APP_ENV=development|test`, `DB_TARGET=local`, the local Compose database (shared guard below) and a fully migrated schema. It refuses production/Vercel markers; remote seeding is not supported. To remove only the fixture rows (by exact id; roles are kept): `npm run db:seed -- --remove --confirm=<database name>`. Because existing rows are never updated, fixture changes only reach a database after `--remove` and a fresh seed.

## Quality checks

| Command                                   | Checks                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run check`                           | format + lint + typecheck + tests (run this before pushing)                                      |
| `npm run format` / `npm run format:check` | Prettier (write / verify)                                                                        |
| `npm run lint`                            | ESLint (typescript-eslint)                                                                       |
| `npm run typecheck`                       | `react-router typegen && tsc`                                                                    |
| `npm test`                                | Test runner (`scripts/run-tests.mjs`); skipped tests are reported loudly but do not fail locally |
| `npm run test:ci`                         | Same, but **any skipped or todo test fails the run** (used by CI)                                |
| `npm run build`                           | Production build                                                                                 |

Database-backed tests create and drop their own uniquely named database on local Postgres. If it is not running they are **skipped, not passed**: `npm test` prints a warning listing them, and `npm run test:ci` exits non-zero. Run `npm run db:up` first. The Docker-context test is likewise skipped when Docker is unavailable. The runner uses the test framework's own events (not output parsing); intentional skips can be allow-listed with a documented reason in `scripts/run-tests.mjs` (currently none).

### Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on pushes to `main` and pull requests, with read-only permissions, no repository secrets, and third-party actions pinned to commit SHAs (Dependabot proposes updates). Jobs:

- **quality:** `npm ci`, format, lint, typegen + `tsc`, production build.
- **database:** disposable Postgres service; migration check, migrate twice (second must be a no-op), health, seed twice (second must create nothing), then `npm run test:ci` (unsafe-target rejection, Docker build-context test; a skipped test fails the job).
- **docker:** the image builds.
- **security:** `npm audit --omit=dev` (fails on high/critical) and a gitleaks scan of the full git history (image pinned by digest).

Pull requests never need production credentials and never connect to production databases. Note: `npm audit` also reports moderate advisories in `drizzle-kit`'s dev-only esbuild dependency; they concern a dev server we do not run and are excluded from the production audit.

## Troubleshooting and recovery

| Symptom                                             | What to do                                                                                                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Node x is not supported`                           | Install Node 24.x (`nvm install` reads `.nvmrc`), then `npm ci`                                                                                                                                                          |
| `Docker daemon is not running`                      | Start Docker Desktop / the docker service, re-run the command                                                                                                                                                            |
| `ports are not available` / port 5432 in use        | Set `POSTGRES_PORT` (e.g. 55432) **and the port in `DATABASE_URL`** in `.env`, then `npm run db:down && npm run db:up`. Windows can reserve port ranges; `netsh int ipv4 show excludedportrange protocol=tcp` lists them |
| `POSTGRES_PASSWORD is not set`                      | Run `npm run setup`                                                                                                                                                                                                      |
| `password authentication failed`                    | The volume keeps the password it was first created with. If the data is only local: `npm run db:reset:local`                                                                                                             |
| `Could not connect ...`                             | `npm run db:up`, then `docker compose ps` and `docker compose logs postgres`; check host/port in `.env` (messages never include credentials)                                                                             |
| Setup was interrupted                               | Run `npm run setup` again; it is idempotent and only fills missing values. A leftover `.env.tmp` can be deleted                                                                                                          |
| `db:migrate` failed                                 | The failing migration is rolled back in a transaction, so the schema is unchanged. Read the error, fix, re-run; check state with `npm run db:health`. Never edit an applied migration                                    |
| `applied migration(s) do not match committed files` | A migration file was edited or removed after it was applied. Restore it from Git (`git checkout -- drizzle/`). For a disposable local database you may instead `npm run db:reset:local` and migrate again                |
| `Seeding refused`                                   | Intentional: check `APP_ENV` (`development`/`test`), `DB_TARGET=local` and that the database is the local Compose one (see below)                                                                                        |
| Database tests are skipped                          | Local Postgres is not reachable: `npm run db:up`                                                                                                                                                                         |
| Corrupted local data, want a clean start            | `npm run db:reset:local`, `npm run db:migrate`, optionally `npm run db:seed` (local only)                                                                                                                                |

## Security notes

- Secrets live only in `.env` (git-ignored) or CI/host environment variables. The CI database password is a throwaway literal for an ephemeral container.
- On Windows, `.env` permissions are not restricted by setup (POSIX gets `0600`); keep the repository inside your user profile.
- Never run migrations against a remote database from a pull-request job. Production migrations are a manual, confirmed step.
- Do not paste connection strings into issues or logs; scripts print only host, port and database name.

## Build and deploy

```bash
npm run build
npm run start
```

The included `Dockerfile` builds a self-hosted image (the CI `docker` job verifies it builds, and a test verifies the build context excludes env files and dev data). The intended production target is Vercel, which is not configured yet.
