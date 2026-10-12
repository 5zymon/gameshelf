# GameShelf web (Next.js) image.
# Build context is the repository root (npm workspaces need the root
# package.json and lockfile):
#   docker compose build web      # or: docker build -f apps/web/Dockerfile .

# Pinned to the CI Node version (.github/workflows/ci.yml); keep in sync with
# .nvmrc and engines.node.
FROM node:24.21.0 AS deps
WORKDIR /app
# No .git in the build context: skip the root `prepare: husky` hook.
ENV HUSKY=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci

FROM deps AS build
# Server-side target of the `/api` rewrite and of SSR (lib/api/server.ts).
# Next.js inlines NEXT_PUBLIC_* at build time, so it must match the compose
# service name here as well as at runtime. The browser never calls it.
ARG NEXT_PUBLIC_API_URL=http://api:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
# Downloads the Sora/Manrope Google fonts (self-hosted): needs network.
RUN npm run build --workspace apps/web

FROM node:24.21.0 AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "/app/node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
