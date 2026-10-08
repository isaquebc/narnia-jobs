# narnia-jobs · atalhos sobre ./start.sh (Linux/macOS). No Windows use .\start.ps1 com os mesmos subcomandos.
# Só depende de Docker; `make tunnel` precisa do cloudflared no host.
.DEFAULT_GOAL := help
SHELL := /bin/bash
ENV_FILE ?= .env
DATA_DIR ?= ./data

.PHONY: help dev dev-down up down purge restart login doctor logs status tunnel \
        test lint typecheck build e2e e2e-ui check install shell

help: ## lista os comandos
	@awk 'BEGIN { FS = ":.*## " } /^[a-zA-Z0-9_-]+:.*## / { printf "  \033[1m%-12s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

## --- desenvolvimento (hot reload; provider claude-code como na produção) ---------------------------------------
dev: ## sobe web (:5173), api (:3100), worker e redis com hot reload; mesma assinatura da produção (NARNIA_PROVIDER=mock para não gastar)
	./start.sh dev

dev-down: ## derruba os containers de desenvolvimento
	docker compose -f docker-compose.dev.yml --profile app down --remove-orphans

install: ## instala dependências no volume node_modules
	./start.sh install

shell: ## shell no container de desenvolvimento
	./start.sh shell

## --- produção local (imagens de produção, provider claude-code) ----------------------------------
up: ## sobe a stack de produção e imprime a URL com o token
	./start.sh up

down: ## para a stack (dados e login preservados)
	./start.sh down

purge: ## para e remove os volumes (apaga o login da assinatura; ./data fica)
	./start.sh down --purge

restart: down up ## down + up

login: ## login da assinatura do Claude dentro do container
	./start.sh login

doctor: ## diagnóstico: login, Redis, pasta de dados, worker
	./start.sh doctor

logs: ## logs da stack (SVC=api|worker|web|redis para filtrar)
	./start.sh logs $(SVC)

status: ## estado dos containers de produção
	./start.sh status

tunnel: ## URL pública temporária (cloudflared) para a stack de produção, já com o token
	@command -v cloudflared >/dev/null || { echo "cloudflared não encontrado no host (https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)"; exit 1; }
	@port=$$(sed -n 's/^NARNIA_PORT=//p' $(ENV_FILE) | tail -n 1); \
	 [[ -n "$$port" ]] || { echo "stack não iniciada: rode 'make up' antes"; exit 1; }; \
	 token=$$(cat $(DATA_DIR)/.token 2>/dev/null || true); \
	 cloudflared tunnel --url "http://127.0.0.1:$$port" --no-autoupdate 2>&1 | \
	 while IFS= read -r line; do \
	   if [[ -z "$$done" && "$$line" =~ https://[a-z0-9-]+\.trycloudflare\.com ]]; then \
	     printf '\n  URL pública (Ctrl+C encerra o túnel):\n\n    %s/?token=%s\n\n' "$${BASH_REMATCH[0]}" "$$token"; done=1; \
	   elif [[ "$$line" == *" ERR "* ]]; then printf '%s\n' "$$line" >&2; fi; \
	 done

## --- qualidade ------------------------------------------------------------------------------------
test: ## testes unitários (Vitest) de todos os pacotes
	./start.sh test

lint: ## Biome
	./start.sh lint

typecheck: ## tsc em todos os pacotes
	./start.sh typecheck

build: ## build de todos os pacotes
	./start.sh build

e2e: ## ponta a ponta completo (Playwright em container + fases de down/up, worker e porta)
	./start.sh e2e

e2e-ui: ## só os cenários de interface (ARGS="--grep E2E-03" para filtrar)
	./start.sh e2e --ui-only $(ARGS)

check: lint typecheck test ## lint + typecheck + testes unitários
