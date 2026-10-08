# syntax=docker/dockerfile:1.7
# Imagem do serviço web: build da SPA (apps/web) e nginx servindo os estáticos com proxy para a api (/api, /ws, /mcp).
ARG PNPM_VERSION=12.9.1

FROM node:22-bookworm-slim AS build
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm COREPACK_HOME=/pnpm/corepack PATH=/pnpm:$PATH CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_OPTIONS=--no-warnings=ExperimentalWarning
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate \
 && mkdir -p /app /pnpm/store /pnpm/corepack && chown -R node:node /app /pnpm
USER node
WORKDIR /app
COPY --chown=node:node . /app
RUN pnpm install --frozen-lockfile --filter "@narnia-jobs/web..." \
 && pnpm --filter @narnia-jobs/web build

FROM nginx:1.29-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
