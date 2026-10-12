# GameShelf API (NestJS) image. Also runs the one-shot `migrate` service.
# Build context is the repository root (npm workspaces need the root
# package.json and lockfile):
#   docker compose build api      # or: docker build -f apps/api/Dockerfile .

# Pinned to the CI Node version (.github/workflows/ci.yml); keep in sync with
# .nvmrc and engines.node. Debian-based (glibc) so sharp/argon2/Prisma
# prebuilds apply.
FROM node:24.21.0 AS deps
WORKDIR /app
# No .git in the build context: skip the root `prepare: husky` hook.
ENV HUSKY=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci

FROM deps AS build
COPY . .
# `prisma generate && nest build` — generate needs no database.
RUN npm run build --workspace apps/api

# Full tree, deliberately not pruned: the `migrate` service runs
# `prisma migrate deploy` (a devDependency) from this image, and the
# operator CLIs (`user:passwd`, …) run through ts-node.
FROM node:24.21.0 AS runtime
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY --from=build /app /app
# Mount point for the durable cover cache (COVERS_DIR, a named volume).
RUN mkdir -p /data/covers
WORKDIR /app/apps/api
EXPOSE 3001
# Gate boot on database readiness. `docker compose restart` (unlike `up`)
# does not honour depends_on, so the API can otherwise start before MySQL is
# ready; a boot-time DB failure leaves the Prisma pool stuck (500s until the
# container is restarted again). wait-for-db retries a real `SELECT 1` first.
CMD ["sh", "-c", "node scripts/wait-for-db.cjs && exec node dist/main"]
