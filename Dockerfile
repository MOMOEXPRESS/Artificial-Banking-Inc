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
  && npm run build -w @policyvault/db \
  && npm run build -w @policyvault/sdk \
  && npm run build -w @policyvault/api \
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
