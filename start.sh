#!/usr/bin/env bash
# narnia-jobs · lançador para Linux/macOS. Só depende de Docker (com Compose v2).
# Produção:        up | down [--purge] | login | doctor | logs | status | restore
# Desenvolvimento: dev | dev-down | test | lint | typecheck | build | shell | cli | test:sh | e2e | install
set -euo pipefail

# --- instâncias: a do dono (padrão) e a do Claude (NARNIA_INSTANCE=claude, valores em .env.claude) -----------------
# Mesmo código-fonte; projetos Docker, portas, banco, Redis e node_modules separados. Os valores do arquivo SEMPRE
# vencem o ambiente (isolamento: um NARNIA_DATA_DIR exportado no shell nunca leva a instância do Claude aos dados do
# dono); a única exceção é NARNIA_PROVIDER (ex.: NARNIA_PROVIDER=claude-code NARNIA_INSTANCE=claude ./start.sh dev).
NARNIA_INSTANCE=${NARNIA_INSTANCE:-}
INSTANCE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
case "$NARNIA_INSTANCE" in
  "" | owner) ;;
  claude)
    while IFS='=' read -r key value; do
      [[ -z "$key" || "$key" == \#* ]] && continue
      [[ "$key" == NARNIA_PROVIDER && -n "${NARNIA_PROVIDER:-}" ]] && continue
      export "$key=$value"
    done < "$INSTANCE_DIR/.env.claude"
    ;;
  *) printf 'erro: NARNIA_INSTANCE desconhecida: %s (use vazio ou "claude")\n' "$NARNIA_INSTANCE" >&2; exit 1 ;;
esac

# --- código da instância do dono (plano de comunicação C7, decisão CM-4) ----------------------------------------------
# Com `.owner-src` (worktree git criada e atualizada por `./start.sh promote`), a instância do dono monta esse código em
# vez da raiz: o que o Claude edita na raiz só chega a ela quando um marco verde é promovido. Dados, backups e `.env`
# continuam na raiz. A instância do Claude nunca usa `.owner-src` (`.env.claude` fixa NARNIA_SRC_DIR=.).
owner_src_dir() { printf '%s\n' "${NARNIA_OWNER_SRC_DIR:-./.owner-src}"; }
if [[ -z "$NARNIA_INSTANCE" || "$NARNIA_INSTANCE" == owner ]] && [[ -z "${NARNIA_SRC_DIR:-}" ]]; then
  if [[ -d "$(owner_src_dir)" ]]; then export NARNIA_SRC_DIR; NARNIA_SRC_DIR=$(owner_src_dir); fi
fi

NARNIA_PORT_START=${NARNIA_PORT_START:-3100}
NARNIA_PORT_END=${NARNIA_PORT_END:-3199}
ENV_FILE=${NARNIA_ENV_FILE:-.env}
DEV_COMPOSE=(docker compose -f docker-compose.dev.yml)
PROD_COMPOSE=(docker compose -f docker-compose.yml)
if [[ -n "${NARNIA_DEV_PROJECT_NAME:-}" ]]; then DEV_COMPOSE=(docker compose -p "$NARNIA_DEV_PROJECT_NAME" -f docker-compose.dev.yml); fi
if [[ -n "${NARNIA_PROD_PROJECT_NAME:-}" ]]; then PROD_COMPOSE=(docker compose -p "$NARNIA_PROD_PROJECT_NAME" -f docker-compose.yml); fi
E2E_PROJECT=${NARNIA_E2E_PROJECT:-narnia-e2e}
E2E_COMPOSE=(docker compose -p "$E2E_PROJECT" -f docker-compose.yml -f docker-compose.e2e.yml)
E2E_DATA_DIR=./.e2e-data

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

# dev_data_host_dir -> pasta de dados do modo dev no host (NARNIA_DEV_DATA_DIR é caminho do container, sob /app)
dev_data_host_dir() {
  local d=${NARNIA_DEV_DATA_DIR:-/app/data}
  printf './%s\n' "${d#/app/}"
}

# host_gh_token -> token do `gh` logado no computador (F03-1); falha sem `gh` ou sem login. Nunca vai para argumento
# de processo nem para .env: quem chama entrega pela entrada padrão ao container (volume gh-auth).
host_gh_token() {
  local bin=${NARNIA_GH_BIN:-gh} token
  command -v "$bin" >/dev/null 2>&1 || return 1
  token=$("$bin" auth token 2>/dev/null) || return 1
  token=${token//$'\r'/}
  token=${token//$'\n'/}
  [[ -n "$token" ]] || return 1
  printf '%s\n' "$token"
}

# --- backups e restauração (F03-fix L1, incidente de 2026-10-10) ------------------------------------------------------

# dev_backup_host_dir -> pasta de backups do modo dev no host (NARNIA_DEV_BACKUP_DIR é caminho do container, sob /app)
dev_backup_host_dir() {
  local d=${NARNIA_DEV_BACKUP_DIR:-/app/backups}
  printf './%s\n' "${d#/app/}"
}

# prod_backup_host_dir -> pasta de backups montada em /backups na produção local
prod_backup_host_dir() { printf '%s\n' "${NARNIA_BACKUP_HOST_DIR:-./backups}"; }

# dev_down_cmd -> comando que derruba a stack de dev DESTA instância (nunca a do dono a partir da instância claude)
dev_down_cmd() { printf '%s\n' "${DEV_COMPOSE[*]} --profile app down --remove-orphans"; }

# resolve_backup_file DIR ARG -> caminho do backup (ARG é caminho ou nome dentro de DIR); falha se não existir
resolve_backup_file() {
  local dir=$1 arg=${2:-}
  [[ -n "$arg" ]] || { printf 'erro: informe o arquivo de backup (veja %s)\n' "$dir" >&2; return 1; }
  if [[ -f "$arg" ]]; then printf '%s\n' "$arg"; return 0; fi
  if [[ -f "$dir/$arg" ]]; then printf '%s\n' "$dir/$arg"; return 0; fi
  printf 'erro: backup não encontrado: %s (pasta %s)\n' "$arg" "$dir" >&2
  return 1
}

# restore_files DATA_DIR BACKUP_DIR FILE STAMP -> guarda o banco atual (e o WAL) como narnia-before-restore-STAMP,
# põe o backup no lugar, apaga WAL/SHM do banco antigo (seriam reaplicados sobre o restaurado) e devolve os uploads
# que faltam. Só mexe em DATA_DIR/narnia.sqlite*, DATA_DIR/uploads e no próprio arquivo de "antes".
restore_files() {
  local data=$1 bdir=$2 file=$3 stamp=$4 db=$1/narnia.sqlite
  mkdir -p "$data" "$bdir"
  if [[ -f "$db" ]]; then
    cp -p "$db" "$bdir/narnia-before-restore-$stamp.sqlite"
    [[ -f "$db-wal" ]] && cp -p "$db-wal" "$bdir/narnia-before-restore-$stamp.sqlite-wal"
  fi
  cp "$file" "$db.restoring" && mv -f "$db.restoring" "$db"
  rm -f "$db-wal" "$db-shm"
  if [[ -d "$bdir/uploads" ]]; then
    mkdir -p "$data/uploads"
    local f
    for f in "$bdir/uploads"/*; do
      [[ -f "$f" ]] || continue
      [[ -e "$data/uploads/$(basename "$f")" ]] || cp -p "$f" "$data/uploads/"
    done
  fi
}

# --- F04 · modo B: plugin no Claude Code do host --------------------------------------------------------------------
# Mecanismo vigente (Claude Code 2.1.296, `claude plugin --help`, 2026-10-11): plugin local via marketplace local
# (`claude plugin marketplace add <dir com .claude-plugin/marketplace.json>` + `claude plugin install p@mkt --scope user`)
# e as tools por `claude mcp add --transport http` no escopo user (F04-8, F04-14). Nomes por instância: o Claude nunca
# usa o servidor nem o marketplace do dono.
mcp_server_name() { printf '%s\n' "${NARNIA_MCP_NAME:-narnia-jobs}"; }
plugin_marketplace_name() { printf '%s\n' "${NARNIA_PLUGIN_MARKETPLACE:-narnia-jobs-local}"; }
plugin_stage_dir() { printf '%s\n' "${NARNIA_PLUGIN_STAGE:-./.plugin-build}"; }

# plugin_endpoint dev|prod -> "URL_BASE|TOKEN" da API da instância corrente (dev: api publicada; prod: via nginx)
plugin_endpoint() {
  if [[ "${1:-dev}" == prod ]]; then
    printf 'http://127.0.0.1:%s|%s\n' "$(env_value "$ENV_FILE" NARNIA_PORT)" "$(read_token)"
  else
    printf 'http://127.0.0.1:%s|%s\n' "${NARNIA_DEV_API_PORT:-3100}" "${NARNIA_TOKEN:-dev-token}"
  fi
}

# plugin_agent URL TOKEN NAME -> agente `recrutador` renderizado pela api (persona e domínios atuais, tools do servidor
# NAME, cartão via `profile_get_card`); o template do repositório tem placeholders e não pode ir cru (auditoria C)
plugin_agent() {
  curl -fsS -m 10 -H "Authorization: Bearer $2" \
    "$1/api/profiles/active/persona-card?format=agent&server=$3" 2>/dev/null
}

# stage_plugin SRC STAGE URL TOKEN MARKETPLACE NAME -> cópia instalável do plugin com .narnia-env (0600), agente
# renderizado, cabeçalho do MCP em mcp-headers.json (0600, lido pelo headersHelper) e marketplace local.
# O .mcp.json não vai no plugin instalado: as tools vêm do `claude mcp add-json` (evita servidor duplicado).
stage_plugin() {
  local src=$1 stage=$2 url=$3 token=$4 mkt=$5 name=$6 agent
  agent=$(plugin_agent "$url" "$token" "$name") && [[ "$agent" == ---* ]] \
    || die "não consegui gerar o agente do recrutador pela api ($url): suba a instância e conclua o primeiro uso antes de instalar o plugin."
  rm -rf "$stage"
  mkdir -p "$stage/.claude-plugin"
  cp -R "$src" "$stage/plugin"
  rm -f "$stage/plugin/.mcp.json" "$stage/plugin/.mcp.json.template" "$stage/plugin/.narnia-env"
  # prompts/ são notas que a api preenche (modo A e a rota do agente); o Claude Code não as usa e elas têm `{{…}}`
  rm -rf "$stage/plugin/prompts"
  printf '%s\n' "$agent" > "$stage/plugin/agents/recrutador.md"
  # recrutador especializado (F06-8): sem placeholder, só as tools do servidor desta instância
  sed "s/mcp__narnia-jobs__\*/mcp__${name}__*/g" "$src/agents/recrutador-especializado.md" \
    > "$stage/plugin/agents/recrutador-especializado.md"
  (umask 077
    printf 'NARNIA_API_URL=%s\nNARNIA_TOKEN=%s\n' "$url" "$token" > "$stage/plugin/.narnia-env"
    printf '{"Authorization":"Bearer %s"}' "$token" > "$stage/mcp-headers.json")
  chmod 600 "$stage/plugin/.narnia-env" "$stage/mcp-headers.json"
  cat > "$stage/.claude-plugin/marketplace.json" <<JSON
{
  "name": "$mkt",
  "owner": { "name": "narnia-jobs" },
  "description": "Instalação local do recrutador do narnia-jobs (gerada pelo install-plugin)",
  "plugins": [
    { "name": "narnia-jobs", "source": "./plugin", "description": "Recrutador sênior do narnia-jobs (instalação local)" }
  ]
}
JSON
}

# install_plugin_with STAGE NAME URL MARKETPLACE -> registra MCP e instala o plugin (idempotente: remove e refaz).
# O token não vai na linha de comando (visível em `ps`) nem na config do Claude Code: o headersHelper lê o cabeçalho do
# arquivo 0600 da cópia (Claude Code 2.1.292: `mcp add-json` aceita `headersHelper`; `mcp add` só aceita --header).
install_plugin_with() {
  local stage=$1 name=$2 url=$3 mkt=$4 bin=${NARNIA_CLAUDE_BIN:-claude} abs
  abs=$(cd "$stage" && pwd)
  "$bin" mcp remove -s user "$name" >/dev/null 2>&1 || true
  "$bin" mcp add-json -s user "$name" \
    "{\"type\":\"http\",\"url\":\"$url/mcp\",\"headersHelper\":\"cat '$abs/mcp-headers.json'\"}" >/dev/null \
    || die "não consegui registrar o servidor MCP $name no Claude Code."
  "$bin" plugin marketplace add "$abs" --scope user >/dev/null 2>&1 \
    || "$bin" plugin marketplace update "$mkt" >/dev/null 2>&1 || true
  "$bin" plugin uninstall "narnia-jobs@$mkt" >/dev/null 2>&1 || true
  "$bin" plugin install "narnia-jobs@$mkt" --scope user >/dev/null \
    || die "não consegui instalar o plugin narnia-jobs@$mkt no Claude Code."
  info "Claude Code: servidor MCP '$name' → $url/mcp e plugin narnia-jobs@$mkt instalados. Reinicie o Claude Code."
  info "Mantenha $abs: o Claude Code lê o token de lá. Mudou a persona? Rode install-plugin de novo."
}

# plugin_doctor NAME URL MARKETPLACE -> confere no Claude Code do host: MCP registrado na porta certa e plugin instalado
plugin_doctor() {
  local name=$1 url=$2 mkt=$3 bin=${NARNIA_CLAUDE_BIN:-claude} out rc=0
  if ! command -v "$bin" >/dev/null 2>&1; then
    printf 'modo B: Claude Code não encontrado neste computador (opcional)\n'; return 0
  fi
  if out=$("$bin" mcp get "$name" 2>/dev/null); then
    if grep -q "$url/mcp" <<<"$out"; then printf 'MCP %s: ok (%s/mcp)\n' "$name" "$url"
    else printf 'MCP %s: porta mudou; rode ./start.sh install-plugin\n' "$name"; rc=1; fi
  else
    printf 'MCP %s: não registrado; rode ./start.sh install-plugin\n' "$name"; rc=1
  fi
  if "$bin" plugin list --json 2>/dev/null | grep -q "narnia-jobs@$mkt"; then
    printf 'plugin narnia-jobs@%s: instalado\n' "$mkt"
  else
    printf 'plugin narnia-jobs@%s: não instalado; rode ./start.sh install-plugin\n' "$mkt"; rc=1
  fi
  return $rc
}

cmd_install_plugin() {
  local mode=dev ep url token
  [[ "${1:-}" == --prod ]] && mode=prod
  if [[ $mode == dev ]] && stack_running && [[ -z "$("${DEV_COMPOSE[@]}" ps -q api 2>/dev/null)" ]]; then mode=prod; fi
  ep=$(plugin_endpoint "$mode"); url=${ep%%|*}; token=${ep#*|}
  [[ -n "$token" && "$url" != *: ]] || die "instância fora do ar: suba com make dev ou ./start.sh up antes de instalar o plugin."
  stage_plugin ./plugin "$(plugin_stage_dir)" "$url" "$token" "$(plugin_marketplace_name)" "$(mcp_server_name)"
  install_plugin_with "$(plugin_stage_dir)" "$(mcp_server_name)" "$url" "$(plugin_marketplace_name)"
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

# deliver_host_gh_token COMPOSE_ARGS… SERVICE -> grava o token do gh do computador em ~/.config/gh/host-token
# (0600) no volume gh-auth do projeto; sem gh logado, apaga o arquivo (a api cai no login próprio do app).
deliver_host_gh_token() {
  local service=${*: -1} token
  local -a compose=("${@:1:$#-1}")
  # volumes criados por imagens antigas nascem com dono root: o app (usuário node) não grava o token nem o login próprio
  "${compose[@]}" run --rm --no-deps -T --user root --entrypoint sh "$service" -c \
    'mkdir -p /home/node/.config/gh && chown node:node /home/node/.config/gh' >/dev/null 2>&1 || true
  if token=$(host_gh_token); then
    printf '%s' "$token" | "${compose[@]}" run --rm --no-deps -T --entrypoint sh "$service" -c \
      'umask 077; mkdir -p "$HOME/.config/gh"; cat > "$HOME/.config/gh/host-token"' >/dev/null 2>&1 \
      && info "GitHub: usando o login do gh deste computador." || info "GitHub: não consegui entregar o token do gh (siga com o login do app)."
  else
    "${compose[@]}" run --rm --no-deps -T --entrypoint sh "$service" -c 'rm -f "$HOME/.config/gh/host-token"' >/dev/null 2>&1 || true
  fi
}

read_token() { "${PROD_COMPOSE[@]}" exec -T api cat /data/.token 2>/dev/null | tr -d '\r\n'; }

cmd_up() {
  require_docker
  local port
  if stack_running; then
    port=$(env_value "$ENV_FILE" NARNIA_PORT)
    info "stack já no ar na porta ${port:-?}; aplicando alterações"
  else
    mkdir -p "${NARNIA_DATA_DIR:-./data}" "$(prod_backup_host_dir)"   # antes do Docker, para pertencerem ao usuário
    mkdir -p "$(dirname "$ENV_FILE")"
    port=$(choose_port "$ENV_FILE") || die "nenhuma porta livre entre ${NARNIA_PORT_START} e ${NARNIA_PORT_END}."
    write_env "$ENV_FILE" NARNIA_PORT "$port"
    info "porta escolhida: $port (gravada em $ENV_FILE)"
  fi
  export NARNIA_PORT="$port"   # o compose só lê o .env padrão; com NARNIA_ENV_FILE diferente, a porta vai pelo ambiente
  "${PROD_COMPOSE[@]}" build
  deliver_host_gh_token "${PROD_COMPOSE[@]}" api
  "${PROD_COMPOSE[@]}" up -d "$@"
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

# --- e2e (M7): Playwright em container contra a stack de produção com provider mock -------------------

# dev_project_name -> nome do projeto do compose de dev (dono do volume node_modules)
dev_project_name() { "${DEV_COMPOSE[@]}" config 2>/dev/null | sed -n 's/^name: //p' | head -n 1; }

e2e_env() {
  NARNIA_DEV_PROJECT=$(dev_project_name)
  [[ -n "$NARNIA_DEV_PROJECT" ]] || die "não consegui descobrir o projeto do compose de dev."
  export NARNIA_DEV_PROJECT NARNIA_UID NARNIA_GID
  NARNIA_UID=$(id -u); NARNIA_GID=$(id -g)
}

e2e_up() {
  "${E2E_COMPOSE[@]}" up -d --wait web api worker redis browser   # browser: PDF do CV (F05)
}

# e2e_play ARGS… -> roda o Playwright no container (código de saída preservado)
e2e_play() {
  "${E2E_COMPOSE[@]}" --profile e2e run --rm --no-deps playwright ./node_modules/.bin/playwright test "$@"
}

e2e_api() {
  # e2e_api METHOD PATH [BODY] -> chama a API da stack e2e de dentro da rede do compose (sem publicar portas)
  local method=$1 path=$2 body=${3:-}
  "${E2E_COMPOSE[@]}" exec -T api node -e '
    const [method, path, body] = process.argv.slice(1);
    fetch("http://127.0.0.1:3100" + path, { method, headers: { authorization: "Bearer e2e-token", "content-type": "application/json" }, body: body || undefined })
      .then(async (r) => { process.stdout.write(await r.text()); process.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.error(String(e)); process.exit(1); });' "$method" "$path" "$body"
}

# E2E-13: porta ocupada no host → ./start.sh up escolhe a próxima; dados criados nela reaparecem na execução seguinte.
# Usa um projeto e um .env descartáveis, provider mock e a pasta de dados ./.e2e-data/port.
e2e_launcher_port() {
  local base block expected port token data_dir=${E2E_DATA_DIR}/port env_file=.e2e-port.env blocker
  base=$(find_free_port) || die "E2E-13: nenhuma porta livre."
  info "E2E-13: ocupando a porta ${base} e subindo o lançador em projeto descartável…"
  # redis:7-alpine já está na máquina (serviço redis); a imagem web não serve de bloqueador porque o nginx sai sem o upstream api
  blocker=$(docker run -d --rm -p "127.0.0.1:${base}:6379" redis:7-alpine)
  local i; for ((i = 0; i < 20; i++)); do port_in_use "$base" && break; sleep 0.5; done
  port_in_use "$base" || die "E2E-13: não consegui ocupar a porta ${base}."
  expected=$(find_free_port "$((base + 1))")
  rm -f "$env_file"; mkdir -p "$data_dir"
  (
    # ENV_FILE e NARNIA_PORT_START são variáveis do script (lidas do ambiente só no carregamento): sobrescrever direto
    ENV_FILE="$env_file"; NARNIA_PORT_START="$base"
    PROD_COMPOSE=(docker compose -p "${E2E_PROJECT}-port" -f docker-compose.yml)   # nunca o projeto de uma instância
    export NARNIA_OAUTH_PORT=""                                                       # porta OAuth aleatória (não colide)
    export COMPOSE_PROJECT_NAME="${E2E_PROJECT}-port" NARNIA_DATA_DIR="$data_dir" NARNIA_PROVIDER=mock
    cmd_up >/dev/null
    port=$(env_value "$env_file" NARNIA_PORT)
    [[ "$port" == "$expected" ]] || die "E2E-13: esperava a porta ${expected}, o lançador escolheu '${port}'."
    token=$(read_token)
    curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null || die "E2E-13: health falhou em ${port}."
    curl -fsS -X PUT -H "authorization: Bearer ${token}" -H 'content-type: application/json' \
      -d '{"displayName":"Porta","fullName":"Teste Porta","email":"porta@example.com","phone":{"e164":"+5511999990000","country":"BR","national":"11999990000"},"city":"Campinas","region":"SP","country":"BR","timezone":"America/Sao_Paulo","remotePref":"remote","relocation":{"mode":"none","countries":[]},"workAuth":[{"country":"BR","status":"citizen"}],"links":[]}' \
      "http://127.0.0.1:${port}/api/user" >/dev/null || die "E2E-13: PUT /api/user falhou em ${port}."
    "${PROD_COMPOSE[@]}" down --remove-orphans >/dev/null
    docker stop "$blocker" >/dev/null
    cmd_up >/dev/null
    port=$(env_value "$env_file" NARNIA_PORT)
    curl -fsS -H "authorization: Bearer ${token}" "http://127.0.0.1:${port}/api/user" | grep -q '"Teste Porta"' \
      || die "E2E-13: o usuário criado antes do down não reapareceu na porta ${port}."
    "${PROD_COMPOSE[@]}" down -v --remove-orphans >/dev/null
  )
  local rc=$?
  docker stop "$blocker" >/dev/null 2>&1 || true
  rm -f "$env_file"
  return $rc
}

cmd_e2e() {
  require_docker; ensure_installed; e2e_env
  local rc=0 ui_only=0 arg; local -a args=()
  for arg in "$@"; do
    case "$arg" in
      --ui-only) ui_only=1 ;;
      *) args+=("$arg") ;;
    esac
  done
  mkdir -p "$E2E_DATA_DIR"
  info "e2e: construindo imagens e subindo a stack (projeto ${E2E_PROJECT}, provider mock)…"
  "${E2E_COMPOSE[@]}" build
  e2e_up
  # cenários de interface (tudo que não depende de reiniciar serviços)
  e2e_play --grep-invert '@ops' "${args[@]}" || rc=$?
  if (( rc == 0 && ui_only == 0 )); then
    # E2E-06: concluir o onboarding → down → up → dashboard e upload preservados
    e2e_play --grep 'E2E-06.*parte 1' || rc=$?
    if (( rc == 0 )); then
      "${E2E_COMPOSE[@]}" down >/dev/null && e2e_up
      e2e_play --grep 'E2E-06.*parte 2' || rc=$?
    fi
  fi
  if (( rc == 0 && ui_only == 0 )); then
    # E2E-12: extração lenta → worker reiniciado no meio → conclui sem propostas duplicadas
    e2e_play --grep 'E2E-12.*parte 1' || rc=$?
    if (( rc == 0 )); then
      "${E2E_COMPOSE[@]}" kill worker >/dev/null && "${E2E_COMPOSE[@]}" up -d --wait worker >/dev/null
      e2e_play --grep 'E2E-12.*parte 2' || rc=$?
    fi
  fi
  "${E2E_COMPOSE[@]}" down -v --remove-orphans >/dev/null
  if (( rc == 0 && ui_only == 0 )); then
    e2e_launcher_port || rc=$?
  fi
  if (( rc == 0 )); then info "e2e: tudo verde."; else info "e2e: falhou (código ${rc}); relatório em apps/e2e/report/index.html"; fi
  return $rc
}

# cmd_restore [--dev|--prod] ARQUIVO -> restaura um backup na instância corrente (para api/worker, troca, sobe)
cmd_restore() {
  require_docker
  local mode="" arg=""
  for a in "$@"; do
    case "$a" in --dev) mode=dev ;; --prod) mode=prod ;; *) arg=$a ;; esac
  done
  if [[ -z "$mode" ]]; then
    if [[ -n "$("${DEV_COMPOSE[@]}" ps -q api 2>/dev/null)" ]]; then mode=dev
    elif stack_running; then mode=prod
    else mode=dev; fi
  fi
  local -a compose data bdir file running
  if [[ "$mode" == dev ]]; then compose=("${DEV_COMPOSE[@]}" --profile app); data=$(dev_data_host_dir); bdir=$(dev_backup_host_dir)
  else compose=("${PROD_COMPOSE[@]}"); data=${NARNIA_DATA_DIR:-./data}; bdir=$(prod_backup_host_dir); fi
  file=$(resolve_backup_file "$bdir" "$arg") || exit 1
  running=$("${compose[@]}" ps -q api 2>/dev/null || true)
  info "restaurando $(basename "$file") em $data (modo $mode); o banco atual fica guardado em $bdir"
  [[ -z "$running" ]] || "${compose[@]}" stop api worker >/dev/null
  restore_files "$data" "$bdir" "$file" "$(date -u +%Y-%m-%dT%H-%M-%S)"
  [[ -z "$running" ]] || "${compose[@]}" start api worker >/dev/null
  info "pronto. Recarregue a página."
}

# cmd_promote [COMMIT] -> move o código da instância do dono (.owner-src) para um commit verde (padrão HEAD)
cmd_promote() {
  if [[ "$NARNIA_INSTANCE" == claude || "${NARNIA_DEV_PROJECT_NAME:-}" == narnia-claude ]]; then
    die "promote atualiza a instância do dono: quem roda é o dono (./start.sh promote), não a instância claude."
  fi
  command -v git >/dev/null 2>&1 || die "git não encontrado."
  local commit=${1:-HEAD} dir sha
  dir=$(owner_src_dir)
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] \
    || die "há alterações não commitadas na raiz; commite (ou descarte) antes de promover."
  sha=$(git rev-parse --verify --quiet "${commit}^{commit}") || die "commit inválido: ${commit}"
  if [[ -d "$dir" ]]; then
    git -C "$dir" checkout -q --detach "$sha" || die "não consegui mover ${dir} para ${sha:0:7}."
  else
    git worktree add -q --detach "$dir" "$sha" >/dev/null 2>&1 || die "não consegui criar ${dir}."
  fi
  info "instância do dono agora no commit ${sha:0:7} (${dir})."
  info "o hot reload aplica o código; se mudaram dependências, composes ou a imagem: make dev-down && make dev"
}

# avaliações no Phoenix (M5): roda os prompts estruturados sobre os datasets, pela ponte da assinatura
cmd_evals() {
  require_docker
  [[ ${1:-} =~ ^(prompts|chat|pdf|cv-review|all)$ ]] || die "uso: ./start.sh evals prompts|chat|pdf|cv-review|all [nome…] [--strict]"
  if [[ -n "$("${DEV_COMPOSE[@]}" ps -q api 2>/dev/null)" ]]; then
    "${DEV_COMPOSE[@]}" exec -T api pnpm --filter @narnia-jobs/api exec tsx src/cli.ts evals "$@"
  elif stack_running; then
    "${PROD_COMPOSE[@]}" exec -T api narnia-jobs evals "$@"
  else
    die "suba a aplicação antes (make dev, ou ./start.sh up com o Phoenix ligado)."
  fi
}

usage() {
  cat <<USAGE
narnia-jobs · ./start.sh <comando>

Uso (produção, só Docker no host):
  up            escolhe uma porta livre (3100–3199), sobe web + api + worker + redis e imprime a URL
  down          para os serviços (dados e login preservados)
  down --purge  para e remove os volumes (apaga o LOGIN da assinatura; a pasta de dados fica)
  promote [c]   leva a instância do dono (.owner-src) para um commit verde (padrão HEAD)
  restore ARQ   restaura um backup de ./backups (para api/worker, guarda o banco atual, troca, sobe)
  login         login da assinatura dentro do container (uma vez)
  doctor        diagnóstico: login, Redis, pasta de dados, worker, MCP e plugin no Claude Code
  install-plugin [--prod]  instala o recrutador no Claude Code deste computador (MCP + plugin, modo B)
  evals prompts|chat|pdf|all [nome…] [--strict]  avaliações no Phoenix: prompts pela ponte; chat e pdf num banco temporário isolado (consome a assinatura)
  logs [svc]    acompanha os logs (api | worker | web | redis)
  status        estado dos serviços

Desenvolvimento (tudo em containers):
  dev-down      para a stack de dev desta instância
  dev           sobe web (http://127.0.0.1:\${NARNIA_DEV_PORT:-5173}), api, worker e redis com hot reload; provider claude-code, token dev-token
  test [args]   roda os testes unitários (Vitest) de todos os pacotes
  lint          Biome (formatação + lint)
  typecheck     tsc em todos os pacotes
  build         build de todos os pacotes
  shell         abre um shell no container de desenvolvimento
  cli <cmd>     roda a CLI narnia-jobs (doctor | login | install-plugin) no container de dev
  test:sh       testa start.sh (bats) e start.ps1 (Pester) em containers
  e2e [args]    testes de ponta a ponta (Playwright em container, provider mock); --ui-only pula down/up, worker e porta
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
    doctor)
      # dentro do api que está no ar (enxerga os processos e o banco aberto); senão, container avulso
      require_docker
      if [[ -n "$("${DEV_COMPOSE[@]}" ps -q api 2>/dev/null)" ]]; then
        "${DEV_COMPOSE[@]}" exec -T api pnpm --filter @narnia-jobs/api exec tsx src/cli.ts doctor
      elif stack_running; then "${PROD_COMPOSE[@]}" exec -T api narnia-jobs doctor
      else "${PROD_COMPOSE[@]}" run --rm api narnia-jobs doctor; fi
      local ep; ep=$(plugin_endpoint dev)
      plugin_doctor "$(mcp_server_name)" "${ep%%|*}" "$(plugin_marketplace_name)" || true ;;
    restore) cmd_restore "$@" ;;
    install-plugin) cmd_install_plugin "$@" ;;
    evals) cmd_evals "$@" ;;
    promote) cmd_promote "$@" ;;
    dev-down) require_docker; "${DEV_COMPOSE[@]}" --profile app down --remove-orphans ;;
    logs)   require_docker; "${PROD_COMPOSE[@]}" logs -f --tail=100 "$@" ;;
    status) require_docker; "${PROD_COMPOSE[@]}" ps ;;
    dev)
      require_docker
      # imagem sempre atualizada (com cache leva segundos): sem isso a instância sobe com a imagem antiga (ex.: sem gh)
      "${DEV_COMPOSE[@]}" --profile app build >/dev/null || die "não consegui construir as imagens de dev."
      ensure_installed
      mkdir -p "$(dev_data_host_dir)" "$(dev_backup_host_dir)"   # antes do Docker: pertencem ao usuário
      [[ -z "$NARNIA_INSTANCE" ]] || info "instância: ${NARNIA_INSTANCE} (projeto ${NARNIA_DEV_PROJECT_NAME:-?}, dados $(dev_data_host_dir))"
      deliver_host_gh_token "${DEV_COMPOSE[@]}" dev
      printf '\n  modo dev (hot reload):  %s\n' "$(app_url "${NARNIA_DEV_PORT:-5173}" "${NARNIA_TOKEN:-dev-token}")"
      if env_has_value "$ENV_FILE" CLAUDE_CODE_OAUTH_TOKEN; then info "login: usando CLAUDE_CODE_OAUTH_TOKEN do $ENV_FILE."
      else info "login da assinatura (uma vez, vale para dev e produção): ./start.sh login   · mock: NARNIA_PROVIDER=mock ./start.sh dev"; fi
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
    e2e)
      cmd_e2e "$@" ;;
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
