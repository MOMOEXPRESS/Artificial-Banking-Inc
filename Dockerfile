# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY apps/worker/package.json apps/worker/
COPY apps/demo-agent/package.json apps/demo-agent/
COPY apps/x402-seller/package.json apps/x402-seller/
COPY packages/common/package.json packages/common/
COPY packages/policy/package.json packages/policy/
COPY packages/ledger/package.json packages/ledger/
COPY packages/custody/package.json packages/custody/
COPY packages/db/package.json packages/db/
COPY packages/sdk/package.json packages/sdk/
RUN npm install --ignore-scripts=false

FROM deps AS build
COPY . .
RUN npm run build -w @policyvault/common \
  && npm run build -w @policyvault/policy \
  && npm run build -w @policyvault/ledger \
  && npm run build -w @policyvault/custody \
  && npm run build -w @policyvault/sdk \
  && npm run build -w @policyvault/api \
  && npm run build -w @policyvault/worker \
  && npm run build -w @policyvault/web

FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV POLICYVAULT_DB=/data/policyvault.db
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
RUN mkdir -p /data
EXPOSE 8787
CMD ["node", "apps/api/dist/index.js"]

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@policyvault/web"]

# Background jobs. Runs the same scheduler as the API, but as its own process
# so sweeps are not coupled to request traffic. Both take the same database
# leases, so at most one ever runs a given job.
FROM node:22-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
ENV POLICYVAULT_DB=/data/policyvault.db
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++   && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
RUN mkdir -p /data
CMD ["node", "apps/worker/dist/index.js"]

# Render builds the final Dockerfile stage when no target is specified. Keep the
# web-service image as the default so an automatic deploy always exposes /health
# and binds PORT. Background workers must explicitly select --target worker.
FROM api AS production
