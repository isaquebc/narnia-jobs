# syntax=docker/dockerfile:1.7
# Imagem da aplicação narnia-jobs (api e worker). Estágios:
#   dev       -> desenvolvimento, lint, testes e build (fonte montada em /app); inclui bats para testar start.sh
#   build     -> instala tudo e roda o build (valida o monorepo; o web usa docker/web.Dockerfile)
#   deps-prod -> node_modules só de produção para api e worker (pnpm install --prod --filter)
#   runtime   -> api e worker em produção (node:22-slim + git + poppler + tessdata + CLI do Claude embutido no SDK)
# As apps rodam a fonte TypeScript com `tsx` (F01-62): os pacotes do workspace exportam fonte TS (F01-28).

ARG PNPM_VERSION=12.9.1
ARG TESSDATA_BASE=https://tessdata.projectnaptha.com/4.0.0_fast

FROM node:22-bookworm-slim AS dev
ARG PNPM_VERSION
ARG TESSDATA_BASE
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/pnpm/corepack \
    PATH=/pnpm:$PATH \
    NODE_OPTIONS=--no-warnings=ExperimentalWarning \
    CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TESSDATA_PATH=/usr/share/tessdata
# poppler-utils: `pdftoppm` renderiza páginas de PDF para o OCR (F01-25). Dados de idioma do Tesseract (por+eng,
# tessdata_fast) ficam em /usr/share/tessdata para o OCR rodar sem rede (F01 §2.1). bats: testes do start.sh (F01-65).
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl poppler-utils bats procps \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p ${TESSDATA_PATH} \
 && curl -fsSL -o ${TESSDATA_PATH}/por.traineddata.gz ${TESSDATA_BASE}/por.traineddata.gz \
 && curl -fsSL -o ${TESSDATA_PATH}/eng.traineddata.gz ${TESSDATA_BASE}/eng.traineddata.gz \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate \
 && mkdir -p /app/node_modules /pnpm/store /pnpm/corepack /home/node/.claude \
 && chown -R node:node /app /pnpm /home/node/.claude
USER node
WORKDIR /app
CMD ["pnpm", "--version"]

FROM dev AS build
COPY --chown=node:node . /app
RUN pnpm install --frozen-lockfile && pnpm build

# node_modules de produção apenas para api e worker (e seus pacotes do workspace)
FROM dev AS deps-prod
ENV NODE_ENV=production
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node apps/worker/package.json apps/worker/
COPY --chown=node:node packages/core/package.json packages/core/
COPY --chown=node:node packages/shared/package.json packages/shared/
COPY --chown=node:node packages/providers/package.json packages/providers/
RUN pnpm install --prod --frozen-lockfile --filter "@narnia-jobs/api..." --filter "@narnia-jobs/worker..."

FROM node:22-bookworm-slim AS runtime
ENV NODE_OPTIONS=--no-warnings=ExperimentalWarning \
    NODE_ENV=production \
    TESSDATA_PATH=/usr/share/tessdata \
    NARNIA_DATA_DIR=/data \
    PORT=3100
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates poppler-utils \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data /home/node/.claude \
 && chown -R node:node /data /home/node/.claude
COPY --from=dev /usr/share/tessdata /usr/share/tessdata
WORKDIR /app
COPY --from=deps-prod --chown=node:node /app /app
COPY --chown=node:node package.json pnpm-workspace.yaml ./
COPY --chown=node:node packages/core/package.json packages/core/
COPY --chown=node:node packages/core/src packages/core/src
COPY --chown=node:node packages/shared/package.json packages/shared/
COPY --chown=node:node packages/shared/src packages/shared/src
COPY --chown=node:node packages/providers/package.json packages/providers/
COPY --chown=node:node packages/providers/src packages/providers/src
COPY --chown=node:node apps/api/package.json apps/api/
COPY --chown=node:node apps/api/src apps/api/src
COPY --chown=node:node apps/worker/package.json apps/worker/
COPY --chown=node:node apps/worker/src apps/worker/src
COPY --chown=node:node docker/entrypoint.sh /app/docker/entrypoint.sh
COPY --chown=node:node docker/narnia-jobs /usr/local/bin/narnia-jobs
RUN chmod +x /app/docker/entrypoint.sh /usr/local/bin/narnia-jobs
USER node
# api: docker/entrypoint.sh · worker: node apps/worker/node_modules/.bin/tsx apps/worker/src/main.ts (ver docker-compose.yml)
CMD ["/app/docker/entrypoint.sh"]
