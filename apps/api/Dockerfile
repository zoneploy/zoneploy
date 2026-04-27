FROM node:20-alpine AS builder

RUN npm install -g pnpm@9.15.0

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/addons/package.json ./packages/addons/
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/types/package.json ./packages/types/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile --filter @zoneploy/api...

COPY packages/addons ./packages/addons
COPY packages/runtime ./packages/runtime
COPY packages/types ./packages/types
COPY apps/api ./apps/api
COPY tsconfig.base.json ./

RUN pnpm --filter @zoneploy/types build
RUN pnpm --filter @zoneploy/addons build
RUN pnpm --filter @zoneploy/runtime build
RUN pnpm --filter @zoneploy/api build

FROM node:20-alpine AS runner

RUN apk add --no-cache bash docker-cli docker-cli-compose git openssh-client
RUN npm install -g pnpm@9.15.0

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/addons/package.json ./packages/addons/
COPY packages/runtime/package.json ./packages/runtime/
COPY packages/types/package.json ./packages/types/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile --filter @zoneploy/api... --prod

COPY --from=builder /app/packages/addons/dist ./packages/addons/dist
COPY --from=builder /app/packages/runtime/dist ./packages/runtime/dist
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

COPY apps/api/src/db/migrations ./apps/api/dist/db/migrations

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "apps/api/dist/server.js"]
