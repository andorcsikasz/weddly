# Single-image Railway build: install workspace deps, build the Vite SPA,
# then run the Bun backend that serves both API and the built frontend.
FROM oven/bun:1.3.10 AS builder
WORKDIR /app

# Workspace manifests first for better layer caching.
COPY package.json bun.lock* ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

RUN bun install --frozen-lockfile

COPY shared   ./shared
COPY backend  ./backend
COPY frontend ./frontend

# VITE_* env vars are baked at build time — declare them as ARGs so Railway
# forwards same-named service variables into the build.
ARG VITE_PLAUSIBLE_DOMAIN
ARG VITE_SENTRY_DSN
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_APPLE_CLIENT_ID
ARG VITE_APPLE_REDIRECT_URI
ARG VITE_EN_CANONICAL_HOST
ENV VITE_PLAUSIBLE_DOMAIN=${VITE_PLAUSIBLE_DOMAIN} \
    VITE_SENTRY_DSN=${VITE_SENTRY_DSN} \
    VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID} \
    VITE_APPLE_CLIENT_ID=${VITE_APPLE_CLIENT_ID} \
    VITE_APPLE_REDIRECT_URI=${VITE_APPLE_REDIRECT_URI} \
    VITE_EN_CANONICAL_HOST=${VITE_EN_CANONICAL_HOST}
RUN cd frontend && bun run build

# --- runtime image ---
FROM oven/bun:1.3.10
WORKDIR /app

# Resolve a clean production-only dependency tree instead of carrying the
# builder's TypeScript/Vite/test toolchain and source tree into production.
COPY package.json bun.lock* ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN bun install --production --frozen-lockfile

COPY --from=builder /app/shared ./shared
COPY --from=builder /app/backend/src ./backend/src
COPY --from=builder /app/backend/tsconfig.json ./backend/tsconfig.json
COPY --from=builder /app/frontend/dist ./frontend/dist

RUN mkdir -p /data && chown -R bun:bun /data

ENV NODE_ENV=production \
    SERVE_FRONTEND=1 \
    DB_PATH=/data/weddly.db \
    UPLOADS_DIR=/data/uploads \
    APP_RUNTIME_UID=1000 \
    APP_RUNTIME_GID=1000

WORKDIR /app/backend
EXPOSE 8787
CMD ["bun", "src/bootstrap.ts"]
