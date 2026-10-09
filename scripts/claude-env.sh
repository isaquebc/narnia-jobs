#!/usr/bin/env bash
# narnia-jobs · ambiente de testes do Claude (harness de desenvolvimento).
# Opera SEMPRE na instância "claude" (.env.claude): projeto Docker narnia-claude, dados em ./.claude-data/dev,
# web :5174, api :3200, token claude-token, provider mock por padrão. Nunca toca ./data, :5173/:3100 nem os
# containers do dono. Uso: scripts/claude-env.sh <comando>  (ou make claude-<comando>)
set -euo pipefail

export NARNIA_INSTANCE=claude
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
# shellcheck source=../start.sh
source "$ROOT/start.sh"

api_base() { printf 'http://127.0.0.1:%s\n' "$NARNIA_DEV_API_PORT"; }
ui_url() { app_url "$NARNIA_DEV_PORT" "$NARNIA_TOKEN"; }
claude_data_dir() { dev_data_host_dir; }

# assert_claude_project -> falha se o compose resolvido não for o da instância do Claude (defesa contra regressões)
assert_claude_project() {
  if [[ "${DEV_COMPOSE[*]}" != *"-p narnia-claude "* ]] || [[ "$(claude_data_dir)" == "./data" ]]; then
    printf 'erro: recusado: o ambiente resolvido não é a instância do Claude (%s)\n' "${DEV_COMPOSE[*]}" >&2
    return 1
  fi
}

# api METHOD PATH [BODY] -> chama a API da instância do Claude e imprime o corpo
api() {
  local method=$1 path=$2 body=${3:-}
  local -a args=(-sS -X "$method" -H "authorization: Bearer ${NARNIA_TOKEN}")
  [[ -n "$body" ]] && args+=(-H 'content-type: application/json' -d "$body")
  curl "${args[@]}" "$(api_base)${path}"
  printf '\n'
}

wait_api() {
  local i
  for ((i = 0; i < ${1:-90}; i++)); do
    curl -s -m 2 "$(api_base)/api/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  die "a api da instância do Claude não respondeu em $(api_base)."
}

is_mock() { [[ "$(api GET /api/provider/status 2>/dev/null)" == *'"authMethod"'* ]] && [[ "${NARNIA_PROVIDER}" == mock ]]; }

cmd_env_up() {
  require_docker; ensure_installed
  mkdir -p "$(claude_data_dir)"
  "${DEV_COMPOSE[@]}" --profile app up -d "$@" >/dev/null
  wait_api
  info "instância claude no ar (provider ${NARNIA_PROVIDER}): $(ui_url)"
}

cmd_env_reset() {
  if is_mock; then
    api POST /api/_test/reset >/dev/null && info "banco da instância claude zerado (rota de teste do mock)."
  else
    "${DEV_COMPOSE[@]}" --profile app stop api worker >/dev/null
    rm -f "$(claude_data_dir)"/narnia.sqlite "$(claude_data_dir)"/narnia.sqlite-shm "$(claude_data_dir)"/narnia.sqlite-wal
    rm -rf "$(claude_data_dir)"/{uploads,readings,digests}
    "${DEV_COMPOSE[@]}" exec -T redis redis-cli FLUSHALL >/dev/null
    "${DEV_COMPOSE[@]}" --profile app start api worker >/dev/null
    wait_api
    info "banco e fila da instância claude zerados (provider real)."
  fi
}

cmd_env_seed() {
  local fixture=${1:-engineer}
  is_mock || die "seed usa a rota de teste do mock; suba com o provider padrão (mock)."
  cmd_env_reset
  api POST /api/_test/seed "{\"fixture\":\"${fixture}\"}" >/dev/null
  info "fixture '${fixture}' semeada."
}

cmd_env_status() {
  "${DEV_COMPOSE[@]}" --profile app ps --format '{{.Service}} {{.Status}}' 2>/dev/null || true
  printf 'api:      %s\n' "$(curl -s -m 2 "$(api_base)/api/health" || echo 'fora do ar')"
  printf 'provider: %s\n' "$(api GET /api/provider/status 2>/dev/null || echo '?')"
  printf 'dados:    %s\n' "$(claude_data_dir)"
  printf 'url:      %s\n' "$(ui_url)"
}

# sql "consulta" -> consulta somente leitura no SQLite da instância do Claude
cmd_env_sql() {
  local q=${1:?consulta SQL}
  "${DEV_COMPOSE[@]}" exec -T api node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.env.NARNIA_DATA_DIR + "/narnia.sqlite", { readOnly: true });
    console.log(JSON.stringify(db.prepare(process.argv[1]).all(), null, 1));' "$q"
}

cmd_env_wipe() {
  "${DEV_COMPOSE[@]}" --profile app down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf ./.claude-data
  info "instância claude removida (containers, volumes e ./.claude-data). Dados do dono intactos."
}

usage() {
  cat <<USAGE
scripts/claude-env.sh <comando>  · ambiente de testes do Claude (instância isolada, nunca toca ./data)

  up [svc…]        sobe web :${NARNIA_DEV_PORT}, api :${NARNIA_DEV_API_PORT}, worker e redis (hot reload) e espera a api
  down             para os containers da instância (dados preservados)
  status           containers, health, provider, pasta de dados e URL
  url              imprime a URL da interface com o token
  reset            zera banco, arquivos derivados e fila da instância
  seed [fixture]   reset + fixture do core (engineer | leader | long; só com mock)
  api M PATH [B]   chama a API da instância (token já incluso)
  sql "consulta"   consulta somente leitura no SQLite da instância
  logs [svc]       logs da instância
  test|lint|typecheck|build|e2e [args]   comandos do start.sh dentro da instância
  wipe             remove containers, volumes e ./.claude-data da instância
USAGE
}

main() {
  assert_claude_project
  local cmd=${1:-help}; shift || true
  case "$cmd" in
    up) cmd_env_up "$@" ;;
    down) "${DEV_COMPOSE[@]}" --profile app stop ;;
    status) cmd_env_status ;;
    url) ui_url ;;
    reset) cmd_env_reset ;;
    seed) cmd_env_seed "$@" ;;
    api) api "$@" ;;
    sql) cmd_env_sql "$@" ;;
    logs) "${DEV_COMPOSE[@]}" --profile app logs -f --tail=100 "$@" ;;
    test | lint | typecheck | build | e2e | shell | cli | install) "$ROOT/start.sh" "$cmd" "$@" ;;
    wipe) cmd_env_wipe ;;
    help | -h | --help) usage ;;
    *) usage; die "comando desconhecido: $cmd" ;;
  esac
}

if [[ -z "${NARNIA_CLAUDE_ENV_NO_MAIN:-}" ]]; then
  main "$@"
fi
