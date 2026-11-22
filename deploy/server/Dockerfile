# Artemis server: the headless gateway (agent, chats, memory, schedules, Telegram, connectors, browser tools), without
# Electron; the web app is optional. Build from the repository root:
#   docker build -f deploy/server/Dockerfile --target server -t artemis-server .
# Run with deploy/server/docker-compose.yml.
# Two targets: "server" (the default in docker-compose.yml: the API only, for the desktop and phone apps) and "full"
# (the API plus the web app served at the same address): docker build --target full ...

# ---- the web app (Expo, exported for the browser) ----
FROM node:22-bookworm-slim AS web
WORKDIR /mobile
COPY mobile/package.json mobile/package-lock.json mobile/app.json ./
# the same versions as on the developer's machine (package-lock.json)
RUN npm ci --no-audit --no-fund
COPY mobile/app ./app
COPY mobile/src ./src
COPY mobile/assets ./assets
RUN npx expo export --platform web --output-dir /web

# ---- the server: the API only ----
FROM node:22-bookworm-slim AS server
ENV NODE_ENV=production \
    ARTEMIS_HOME=/data \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends ca-certificates tini git curl python3 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# runtime dependencies only (no Electron, no build tools); scripts off: nothing here needs a native build
RUN pnpm install --prod --frozen-lockfile --ignore-scripts && \
    pnpm add -O playwright-core --ignore-scripts && \
    npx playwright-core install --with-deps chromium && \
    pnpm store prune
COPY electron ./electron
COPY bin ./bin
RUN useradd --create-home --uid 10001 artemis && mkdir -p /data && chown -R artemis:artemis /data /ms-playwright
USER artemis
VOLUME ["/data"]
EXPOSE 8789
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD curl -fsS http://127.0.0.1:8789/v1/ping || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
# 0.0.0.0 inside the container; publish the port on 127.0.0.1 only (docker-compose.yml) and let the tunnel reach it
CMD ["node", "bin/artemis.js", "gateway", "--host", "0.0.0.0", "--port", "8789", "--no-keychain", "--no-computer"]

# ---- optional: the server plus the web app (docker build --target full, or target: full in docker-compose.yml) ----
FROM server AS full
COPY --from=web --chown=artemis:artemis /web /app/web
ENV ARTEMIS_WEB_ROOT=/app/web
