#!/usr/bin/env bash
# narnia-jobs · lançador para Linux/macOS. Só depende de Docker (com Compose v2).
# Produção:        up | down [--purge] | login | doctor | logs | status
# Desenvolvimento: dev | test | lint | typecheck | build | shell | cli | test:sh | install
set -euo pipefail

NARNIA_PORT_START=${NARNIA_PORT_START:-3100}
NARNIA_PORT_END=${NARNIA_PORT_END:-3199}
ENV_FILE=${NARNIA_ENV_FILE:-.env}
DEV_COMPOSE=(docker compose -f docker-compose.dev.yml)
PROD_COMPOSE=(docker compose -f docker-compose.yml)

die() { printf 'erro: %s\n' "$*" >&2; exit 1; }
info() { printf '» %s\n' "$*"; }

# --- funções puras (testadas em scripts/test/start.bats) ---------------------------------------

# port_in_use PORT -> 0 se algo escuta em 127.0.0.1:PORT
port_in_use() {
  # conecta num subshell: o socket fecha ao sair dele, sem tocar nos descritores do chamador (o bats usa o fd 3)
  local port=$1
  if (exec 9<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    return 0
  fi
  return 1
}

# find_free_port [START] [END] -> imprime a primeira porta livre no intervalo; 1 se nenhuma
find_free_port() {
  local start=${1:-$NARNIA_PORT_START} end=${2:-$NARNIA_PORT_END} port
  for ((port = start; port <= end; port++)); do
    if ! port_in_use "$port"; then
      printf '%s\n' "$port"
      return 0
    fi
  done
  return 1
}

# write_env FILE KEY VALUE -> grava/atualiza KEY=VALUE preservando as demais linhas
write_env() {
  local file=$1 key=$2 value=$3 tmp
  [[ -f "$file" ]] || : > "$file"
  tmp=$(mktemp)
  grep -v -E "^${key}=" "$file" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$file"
}

# env_value FILE KEY -> imprime o valor de KEY em FILE (vazio se ausente)
env_value() {
  local file=$1 key=$2
  [[ -f "$file" ]] || return 0
  sed -n -E "s/^${key}=(.*)$/\1/p" "$file" | tail -n 1
}

# env_has_value FILE KEY -> 0 se KEY existe e não está vazia
env_has_value() {
  local v
  v=$(env_value "$1" "$2")
  [[ -n "$v" ]]
}

# choose_port FILE [START] [END] -> reutiliza NARNIA_PORT salva em FILE se estiver livre e no intervalo; senão a primeira livre
choose_port() {
  local file=$1 start=${2:-$NARNIA_PORT_START} end=${3:-$NARNIA_PORT_END} saved
  saved=$(env_value "$file" NARNIA_PORT)
  if [[ "$saved" =~ ^[0-9]+$ ]] && (( saved >= start && saved <= end )) && ! port_in_use "$saved"; then
    printf '%s\n' "$saved"
    return 0
  fi
  find_free_port "$start" "$end"
}

# app_url PORT TOKEN -> URL de abertura da interface
app_url() { printf 'http://127.0.0.1:%s/?token=%s\n' "$1" "$2"; }

# --- infraestrutura ----------------------------------------------------------------------------

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker não encontrado. Instale o Docker Desktop (Windows/macOS) ou o Docker Engine (Linux)."
  docker info >/dev/null 2>&1 || die "Docker não está rodando. Inicie o Docker e tente de novo."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 não encontrado (comando 'docker compose')."
}

dev_run() { "${DEV_COMPOSE[@]}" run --rm dev "$@"; }

ensure_installed() {
  # node_modules vive em volume nomeado: instala quando o volume está vazio ou o lockfile mudou
  dev_run sh -c 'test -f node_modules/.modules.yaml && pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 || pnpm install --frozen-lockfile' >/dev/null
}

# stack_running -> 0 se o serviço web da produção está no ar
stack_running() {
  [[ -n "$("${PROD_COMPOSE[@]}" ps -q web 2>/dev/null)" ]]
}

# wait_healthy SERVICE SECONDS -> espera o healthcheck do compose ficar "healthy"
wait_healthy() {
  local service=$1 limit=${2:-120} i cid status
  for ((i = 0; i < limit; i++)); do
    cid=$("${PROD_COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)
    if [[ -n "$cid" ]]; then
      status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)
      [[ "$status" == "healthy" ]] && return 0
      [[ "$status" == "exited" || "$status" == "dead" ]] && return 2
    fi
    sleep 1
  done
  return 1
}

read_token() { "${PROD_COMPOSE[@]}" exec -T api cat /data/.token 2>/dev/null | tr -d '\r\n'; }

cmd_up() {
  require_docker
  local port
  if stack_running; then
    port=$(env_value "$ENV_FILE" NARNIA_PORT)
    info "stack já no ar na porta ${port:-?}; aplicando alterações"
  else
    mkdir -p "${NARNIA_DATA_DIR:-./data}"   # cria a pasta antes do Docker, para ela pertencer ao usuário e não ao root
    port=$(choose_port "$ENV_FILE") || die "nenhuma porta livre entre ${NARNIA_PORT_START} e ${NARNIA_PORT_END}."
    write_env "$ENV_FILE" NARNIA_PORT "$port"
    info "porta escolhida: $port (gravada em $ENV_FILE)"
  fi
  "${PROD_COMPOSE[@]}" up -d --build "$@"
  info "aguardando a api ficar saudável…"
  if ! wait_healthy api 120; then
    "${PROD_COMPOSE[@]}" logs --tail=40 api >&2 || true
    die "a api não ficou saudável em 120 s. Veja './start.sh logs api'."
  fi
  local token
  token=$(read_token)
  [[ -n "$token" ]] || die "não consegui ler o token de boot em /data/.token."
  printf '\n  narnia-jobs está no ar:\n\n    %s\n\n' "$(app_url "$port" "$token")"
  if env_has_value "$ENV_FILE" CLAUDE_CODE_OAUTH_TOKEN; then
    info "login: usando CLAUDE_CODE_OAUTH_TOKEN do $ENV_FILE."
  else
    info "login da assinatura (uma vez): ./start.sh login   · diagnóstico: ./start.sh doctor"
  fi
  info "dados em ${NARNIA_DATA_DIR:-./data} · parar: ./start.sh down"
}

cmd_down() {
  require_docker
  if [[ "${1:-}" == "--purge" ]]; then
    printf 'Isso remove também os volumes: o LOGIN da assinatura (claude-auth) e a fila (redis-data).\n'
    printf 'A pasta de dados (%s) NÃO é apagada. Continuar? [s/N] ' "${NARNIA_DATA_DIR:-./data}"
    local answer; read -r answer
    [[ "$answer" =~ ^[sSyY]$ ]] || die "cancelado."
    "${PROD_COMPOSE[@]}" down -v --remove-orphans
  else
    "${PROD_COMPOSE[@]}" down --remove-orphans "$@"
  fi
}

cmd_login() {
  require_docker
  if env_has_value "$ENV_FILE" CLAUDE_CODE_OAUTH_TOKEN; then
    info "atenção: CLAUDE_CODE_OAUTH_TOKEN está definido em $ENV_FILE e prevalece sobre o login no volume."
  fi
  cat <<MSG
Login da assinatura do Claude dentro do container (credencial no volume claude-auth).
O CLI vai imprimir uma URL: abra no navegador, autorize e cole o código de volta aqui.
MSG
  "${PROD_COMPOSE[@]}" run --rm --no-deps api narnia-jobs login
}

usage() {
  cat <<USAGE
narnia-jobs · ./start.sh <comando>

Uso (produção, só Docker no host):
  up            escolhe uma porta livre (3100–3199), sobe web + api + worker + redis e imprime a URL
  down          para os serviços (dados e login preservados)
  down --purge  para e remove os volumes (apaga o LOGIN da assinatura; a pasta de dados fica)
  login         login da assinatura dentro do container (uma vez)
  doctor        diagnóstico: login, Redis, pasta de dados, worker
  logs [svc]    acompanha os logs (api | worker | web | redis)
  status        estado dos serviços

Desenvolvimento (tudo em containers):
  dev           sobe web (http://127.0.0.1:\${NARNIA_DEV_PORT:-5173}), api, worker e redis com hot reload
  test [args]   roda os testes unitários (Vitest) de todos os pacotes
  lint          Biome (formatação + lint)
  typecheck     tsc em todos os pacotes
  build         build de todos os pacotes
  shell         abre um shell no container de desenvolvimento
  cli <cmd>     roda a CLI narnia-jobs (doctor | login | install-plugin) no container de dev
  test:sh       testa start.sh (bats) e start.ps1 (Pester) em containers
  install       instala dependências no volume node_modules
USAGE
}

main() {
  local cmd=${1:-help}
  shift || true
  case "$cmd" in
    up)     cmd_up "$@" ;;
    down)   cmd_down "$@" ;;
    login)  cmd_login ;;
    doctor) require_docker; "${PROD_COMPOSE[@]}" run --rm api narnia-jobs doctor ;;
    logs)   require_docker; "${PROD_COMPOSE[@]}" logs -f --tail=100 "$@" ;;
    status) require_docker; "${PROD_COMPOSE[@]}" ps ;;
    dev)
      require_docker; ensure_installed
      "${DEV_COMPOSE[@]}" --profile app up "$@" ;;
    test)
      require_docker; ensure_installed
      dev_run pnpm test "$@" ;;
    lint)
      require_docker; ensure_installed
      dev_run pnpm lint "$@" ;;
    typecheck)
      require_docker; ensure_installed
      dev_run pnpm typecheck "$@" ;;
    build)
      require_docker; ensure_installed
      dev_run pnpm build "$@" ;;
    install)
      require_docker
      dev_run pnpm install "$@" ;;
    shell)
      require_docker; ensure_installed
      dev_run bash ;;
    cli)
      require_docker; ensure_installed
      "${DEV_COMPOSE[@]}" run --rm dev pnpm --filter @narnia-jobs/api exec tsx src/cli.ts "$@" ;;
    test:sh)
      # bats dentro da imagem de dev (precisa de Node para ocupar portas nos testes) + Pester para o start.ps1
      require_docker; ensure_installed
      dev_run bats scripts/test
      docker run --rm -v "$PWD:/code:ro" -w /code -e NARNIA_PS_NO_MAIN=1 mcr.microsoft.com/powershell:7.4-ubuntu-22.04 \
        pwsh -NoProfile -Command "Install-Module Pester -MinimumVersion 5.0 -Force -Scope CurrentUser -SkipPublisherCheck | Out-Null; Invoke-Pester -Path scripts/test -Output Detailed -ErrorAction Stop" ;;
    help|-h|--help)
      usage ;;
    *)
      usage; die "comando desconhecido: $cmd" ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
