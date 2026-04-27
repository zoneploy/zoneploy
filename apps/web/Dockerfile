FROM node:20-alpine AS builder

RUN npm install -g pnpm@9.15.0

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/types/package.json ./packages/types/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile --filter @zoneploy/web...

COPY packages/types ./packages/types
COPY apps/web ./apps/web
COPY tsconfig.base.json ./

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_DOCS_URL=https://docs.zoneploy.com
ENV VITE_DOCS_URL=$VITE_DOCS_URL

RUN pnpm --filter @zoneploy/types build
RUN pnpm --filter @zoneploy/web build

FROM nginx:alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://127.0.0.1/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
