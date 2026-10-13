---
type: Feature
title: Database Connection & Boot Readiness
description: The API's runtime MySQL connection (Prisma driver adapter), the caching_sha2_password option it needs, and the boot gate that waits for the database before building the pool.
tags: [database, prisma, mysql, operations]
status: draft
generated: { by: opencode/home-model, at: 2026-10-13T00:45:00Z }
---

# Overview

The API talks to MySQL 8.4 through Prisma 7's Rust-free client with the
`@prisma/adapter-mariadb` driver adapter (ADR-001 pins the server version and
`utf8mb4`). Two connection details are easy to get wrong and produce a
confusing failure — an API that logs "listening" but answers every request
with a 500 — so they are handled centrally in
`apps/api/src/prisma/prisma.service.ts`.

# Connection

`PrismaService` builds the adapter from `DATABASE_URL`:

```ts
adapter: new PrismaMariaDb(withMariadbOptions(DATABASE_URL));
```

`withMariadbOptions` appends two things to the URL:

- **`allowPublicKeyRetrieval=true`** — the `gameshelf` account authenticates
  with `caching_sha2_password`. Over a plaintext connection the driver can only
  complete the **first** authentication (a cold server-side auth cache, i.e.
  the first connection after every MySQL restart) by fetching the server's RSA
  public key, and the mariadb driver refuses that unless this option is set:
  `ER_CANNOT_RETRIEVE_RSA_KEY`. Once the cache is warm the fast path needs no
  key, which is why the failure looks intermittent. The Prisma CLI
  (`prisma migrate …`) does the handshake itself and does not need the option.
- Per-call options, used only by the readiness probe below.

# Why the boot gate exists

The mariadb connection pool **never recovers from a failed first connection**:
a pool built while MySQL is down keeps returning
`pool timeout: failed to retrieve a connection from pool after …ms
(pool connections: active=0 idle=0 limit=10)` for every query, even after
MySQL is healthy again, and even for a brand-new pool in the same process.

`PrismaService.onModuleInit` therefore probes with a short-lived client (short
`acquireTimeout`/`connectTimeout`, so a probe against a down database fails in
~2 s) and only calls `this.$connect()` once a real authenticated `SELECT 1`
succeeds. It retries every 2 s and gives up after 120 s with
`Database is not reachable after 120s — is MySQL running and migrated? (…)`,
so the API fails fast instead of serving 500s forever. This covers both
`npm run dev` before `docker compose up -d mysql` has finished and any
container restart.

# Scope

- Applies to every process that boots `AppModule` — the API and the CLI
  commands that resolve `PrismaService` (`db:seed`, `db:clear-dev`, …).
- The web app never connects to MySQL directly.
- `docker compose` runs the same gate as a separate pre-boot step in the API
  image (`apps/api/scripts/wait-for-db.cjs`, PR #79).
- Local / LAN only. `allowPublicKeyRetrieval` is acceptable because the
  database is local; a deployment reachable over an untrusted network should
  use TLS instead.

# Out of scope

- TLS between the API and MySQL.
- Connection pooling tuning beyond the adapter defaults.
- Read replicas or failover.
