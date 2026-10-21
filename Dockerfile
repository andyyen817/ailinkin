FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && node scripts/build-worker.mjs && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 BIND_HOST=0.0.0.0
ENV APP_RUNTIME_ENABLED=false WORKERS_ENABLED=false MAIL_SENDING_ENABLED=false
COPY --from=build --chown=node:node /app/.next/standalone ./.next/standalone
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/scripts/start.mjs /app/scripts/container-entry.mjs /app/scripts/runtime-guard.mjs ./scripts/
# Public-page readers use channel:'chrome'. Install the engine without launching it.
RUN node node_modules/playwright/cli.js install --with-deps chrome
USER node
EXPOSE 8080
CMD ["node","scripts/container-entry.mjs"]
