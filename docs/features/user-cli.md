---
type: Feature
title: User CLI
description: Operator-run `user:create` / `user:passwd` commands that provision accounts without any email infrastructure.
tags: [cli, auth, operations]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-06T00:00:00Z }
---

# Overview

GameShelf has **no public self-registration** (see
[Auth Foundation](/auth-foundation.md) and the README, "Accounts and
registration"). The one-time [First-run Setup](/first-run-setup.md) creates the
very first account, but after that there is deliberately no web route that can
create or re-provision a user. The User CLI is the operator escape hatch: it
runs on the server host, boots the same Nest application context as the API, and
calls the same `UsersService` used by setup.

There is **no email or SMTP infrastructure** — the CLI is the only account
recovery path when the sole account is locked out.

# Commands

Both commands are root npm scripts that delegate to the `apps/api` workspace and
forward arguments. Run them from the repository root.

| Command                                  | What it does                                              |
| ---------------------------------------- | --------------------------------------------------------- |
| `npm run user:create -- --email <email>` | Create an account that can immediately log in.            |
| `npm run user:passwd -- --email <email>` | Replace the stored password hash for an existing account. |

The entry point is `apps/api/src/cli/users.ts`, executed with `ts-node` against
`apps/api/tsconfig.json`, so no prior build is required — important for the
locked-out recovery path. It bootstraps
`NestFactory.createApplicationContext(AppModule)` and resolves `UsersService`.

Booting `AppModule` loads the same root `.env` as the server, so a valid
`SESSION_SECRET` and `DATABASE_URL` are required.

# Password entry

The password is **never accepted as a command-line argument**; `--password` and
`--password=...` are rejected with an error. There is also no environment
variable for it.

- **Interactive TTY:** the command prints `Password: ` and reads input with
  echo disabled. It then asks `Confirm password: ` and requires the two entries
  to match. Only the prompt and a trailing newline are printed.
- **Non-TTY (piped input / CI):** exactly one line is read from stdin and the
  confirmation prompt is skipped, since nothing is echoed on a pipe anyway:

  ```bash
  printf '%s\n' "$NEW_PASSWORD" | npm run user:passwd -- --email player@example.com
  ```

An empty password is rejected on both paths.

# Shared logic

Both commands reuse the existing `UsersService` creation/provisioning path, so
hashing and validation cannot diverge from the web paths:

- `createUser({ email, password })` — normalizes the email (trim + lowercase),
  hashes with Argon2id, and inserts. A duplicate email (unique index
  `users.email`, Prisma `P2002`) maps to `409` and a readable message.
- `setPassword({ email, password })` — runs the same `prepareUser` normalization
  and hashing, then updates the row by unique `email`. A missing account
  (Prisma `P2025`) maps to `404`.

`prepareUser` is the single source of truth for length bounds
(`EMAIL_MAX_LENGTH = 255`, `PASSWORD_MAX_LENGTH = 1024`), blank/empty checks,
normalization, and hashing. It deliberately performs **no email-format
validation** — the web path has none either, and uniqueness is enforced by the
database.

# Exit codes and messages

| Situation                                  | Exit | Message (stderr unless noted)                                 |
| ------------------------------------------ | ---- | ------------------------------------------------------------- |
| Success                                    | `0`  | `Created user <id> <email>` / `Updated password ...` (stdout) |
| Missing/unknown command, missing `--email` | `1`  | usage / `--email is required`                                 |
| Password passed as an argument             | `1`  | `Do not pass the password as an argument; ...`                |
| Empty password or mismatched confirmation  | `1`  | `password must not be empty.` / `passwords do not match.`     |
| Blank email / oversize email or password   | `1`  | the `BadRequestException` message                             |
| Duplicate email on `create`                | `1`  | `A user with email "<email>" already exists`                  |
| Unknown email on `passwd`                  | `1`  | `No user with email "<email>" was found`                      |

`process.exitCode` is set rather than calling `process.exit`, so the Nest
context closes cleanly (disconnecting Prisma and stopping the scheduler).

# Out of scope

- Email/SMTP password reset.
- Password policy and strength rules.
- Roles and permissions (single permission level — decision #14).
- Revoking existing sessions when a password changes (the ticket only requires
  the old password to stop working for new logins).
- Email-format validation (`@IsEmail`), matching the web path.
