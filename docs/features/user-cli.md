---
type: Feature
title: User CLI
description: Operator-run `user:create` / `user:passwd` commands that provision accounts without any email infrastructure.
tags: [cli, auth, operations]
status: draft
generated: { by: opencode/home-model, at: 2026-10-11T22:30:00Z }
---

# Overview

GameShelf has **no public self-registration** (see
[Auth Foundation](/auth-foundation.md) and
[Accounts and registration](/references/installation.md#accounts-and-registration)). The one-time [First-run Setup](/first-run-setup.md) creates the
very first account, but after that there is deliberately no web route that can
create or re-provision a user. The User CLI is the operator escape hatch: it
runs on the server host, boots the same Nest application context as the API, and
calls the same `UsersService` used by setup.

There is **no email or SMTP infrastructure** — the CLI is the only account
recovery path when the sole account is locked out.

# Commands

Both commands are root npm scripts that delegate to the `apps/api` workspace and
forward arguments. Run them from the repository root.

| Command                                  | What it does                                                       |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `npm run user:create`                    | Create an account interactively (prompts for email and password).  |
| `npm run user:create -- --email <email>` | Create an account, skipping the email prompt.                      |
| `npm run user:passwd`                    | Replace a password interactively (prompts for email and password). |
| `npm run user:passwd -- --email <email>` | Replace the stored password hash for an existing account.          |

Both commands also accept `--password <password>` or `--password=<password>`,
which skips the password prompts **and** the confirmation. Use it only for
scripts and CI (see [Password entry](#password-entry)).

The entry point is `apps/api/src/cli/users.ts`, executed with `ts-node` against
`apps/api/tsconfig.json`, so no prior build is required — important for the
locked-out recovery path. It bootstraps
`NestFactory.createApplicationContext(AppModule)` and resolves `UsersService`.

Booting `AppModule` loads the same root `.env` as the server, so a valid
`SESSION_SECRET` and `DATABASE_URL` are required.

# Password entry

- **Interactive TTY:** the command prompts for a missing `Email: ` (echoed), then
  `Password: ` and `Confirm password: ` with echo disabled. The two password
  entries must match. Only the prompts and a trailing newline are printed.
- **`--password` (scripts and CI):** accepted as a convenience. It is visible in
  shell history and in `ps`, so piping the password on stdin is preferred:

  ```bash
  printf '%s\n' "$NEW_PASSWORD" | npm run user:passwd -- --email player@example.com
  ```

  `--password` takes the next argument as its value, so a value that itself
  begins with `--` must use the `=` form — `--password=--x` — because
  `--password --foo` is rejected as a missing value (see `--email`/`--password`
  parsing in `apps/api/src/cli/args.ts`).

- **Non-TTY (piped input / CI):** `--email` is required (there is no one to type
  it). The password comes from `--password`, or, if that is missing, exactly one
  line of stdin; the confirmation prompt is skipped because nothing is echoed on
  a pipe anyway.

An empty password is rejected on every path. A blank or missing email is
rejected before the password is ever requested.

## Why the prompt goes through `question()`

`readTtyLine` lets readline own the prompt (`rl.question(promptText, …)`)
instead of pre-writing it. readline's line refresh (`kRefreshLine`) runs
`cursorTo(output, 0)` and `clearScreenDown(output)` **directly on the stream**,
bypassing `_writeToOutput`. That refresh runs when `question()` first renders the
prompt and again on edits such as backspace or delete; plain characters typed at
the end of the line are appended with no clear. A prompt written before the
question is therefore erased at `prompt()`, before the user types anything.
Passing the prompt to `question()` makes the refresh redraw `prompt + line`
after the clear, so the prompt stays visible while typing and after backspace.
The no-echo override then keeps only the prompt and drops the typed secret.

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

| Situation                                 | Exit | Message (stderr unless noted)                                 |
| ----------------------------------------- | ---- | ------------------------------------------------------------- |
| Success                                   | `0`  | `Created user <id> <email>` / `Updated password ...` (stdout) |
| Missing/unknown command                   | `1`  | usage                                                         |
| Missing `--email` off a TTY               | `1`  | `--email is required when not running in a terminal.`         |
| Blank email (prompted or `--email`)       | `1`  | `email must not be empty.`                                    |
| Empty password or mismatched confirmation | `1`  | `password must not be empty.` / `passwords do not match.`     |
| Oversize email or password                | `1`  | the `BadRequestException` message                             |
| Duplicate email on `create`               | `1`  | `A user with email "<email>" already exists`                  |
| Unknown email on `passwd`                 | `1`  | `No user with email "<email>" was found`                      |

`process.exitCode` is set rather than calling `process.exit`, so the Nest
context closes cleanly (disconnecting Prisma and stopping the scheduler).

# Out of scope

- Email/SMTP password reset.
- Password policy and strength rules.
- Roles and permissions (single permission level — decision #14).
- Revoking existing sessions when a password changes (the ticket only requires
  the old password to stop working for new logins).
- Email-format validation (`@IsEmail`), matching the web path.
