#!/usr/bin/env bats
# Testes do lançador start.sh (funções puras). Rodar com: ./start.sh test:sh (bats dentro da imagem de dev)

docker_compose_service_has_init() { # docker_compose_service_has_init ARQUIVO SERVIÇO -> 0 se o serviço declara init: true
  awk -v svc="  $2:" '
    $0 == svc { inside = 1; next }
    inside && /^  [a-z]/ { inside = 0 }
    inside && /^    init: true/ { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$1"
}

setup() {
  source "$BATS_TEST_DIRNAME/../../start.sh"
  TMP=$(mktemp -d)
}

teardown() {
  rm -rf "$TMP"
  if [[ -n "${LISTENER_PID:-}" ]]; then kill "$LISTENER_PID" 2>/dev/null || true; fi
}

occupy_port() { # ocupa a porta $1 com um servidor TCP em Node (aceita várias conexões; `nc -l` encerra após a primeira)
  node -e "require('net').createServer(s=>s.end()).listen($1,'127.0.0.1')" &
  LISTENER_PID=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do port_in_use "$1" && break; sleep 0.1; done
}

@test "find_free_port devolve o início do intervalo quando está livre" {
  run find_free_port 3150 3159
  [ "$status" -eq 0 ]
  [ "$output" = "3150" ]
}

@test "find_free_port pula uma porta ocupada" {
  occupy_port 3160
  run find_free_port 3160 3169
  [ "$status" -eq 0 ]
  [ "$output" = "3161" ]
}

@test "find_free_port falha quando todo o intervalo está ocupado" {
  occupy_port 3170
  run find_free_port 3170 3170
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "write_env cria o arquivo e grava a chave" {
  write_env "$TMP/.env" NARNIA_PORT 3101
  run cat "$TMP/.env"
  [ "$output" = "NARNIA_PORT=3101" ]
}

@test "write_env atualiza a chave preservando as outras linhas" {
  printf 'OUTRA=1\nNARNIA_PORT=3100\nMAIS=2\n' > "$TMP/.env"
  write_env "$TMP/.env" NARNIA_PORT 3105
  run env_value "$TMP/.env" NARNIA_PORT
  [ "$output" = "3105" ]
  run grep -c "" "$TMP/.env"
  [ "$output" = "3" ]
  run grep -E '^(OUTRA=1|MAIS=2)$' "$TMP/.env"
  [ "$status" -eq 0 ]
}

@test "write_env não confunde chaves com o mesmo prefixo" {
  printf 'NARNIA_PORT_START=3100\n' > "$TMP/.env"
  write_env "$TMP/.env" NARNIA_PORT 3102
  run env_value "$TMP/.env" NARNIA_PORT_START
  [ "$output" = "3100" ]
  run env_value "$TMP/.env" NARNIA_PORT
  [ "$output" = "3102" ]
}

@test "env_value devolve vazio para arquivo inexistente ou chave ausente" {
  run env_value "$TMP/nao-existe" NARNIA_PORT
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# --- M6: produção ------------------------------------------------------------------------------

@test "choose_port reutiliza a porta salva no .env quando ela está livre" {
  printf 'NARNIA_PORT=3182\n' > "$TMP/.env"
  run choose_port "$TMP/.env" 3180 3189
  [ "$status" -eq 0 ]
  [ "$output" = "3182" ]
}

@test "choose_port procura outra porta quando a salva está ocupada" {
  occupy_port 3183
  printf 'NARNIA_PORT=3183\n' > "$TMP/.env"
  run choose_port "$TMP/.env" 3183 3189
  [ "$status" -eq 0 ]
  [ "$output" = "3184" ]
}

@test "choose_port usa o início do intervalo sem .env" {
  run choose_port "$TMP/nao-existe" 3190 3195
  [ "$status" -eq 0 ]
  [ "$output" = "3190" ]
}

@test "choose_port ignora porta salva fora do intervalo" {
  printf 'NARNIA_PORT=9999\n' > "$TMP/.env"
  run choose_port "$TMP/.env" 3196 3198
  [ "$status" -eq 0 ]
  [ "$output" = "3196" ]
}

@test "app_url monta a URL de abertura com porta e token" {
  run app_url 3101 abc123
  [ "$output" = "http://127.0.0.1:3101/?token=abc123" ]
}

@test "env_has_value distingue chave ausente, vazia e preenchida" {
  printf 'CLAUDE_CODE_OAUTH_TOKEN=\nOUTRA=x\n' > "$TMP/.env"
  run env_has_value "$TMP/.env" CLAUDE_CODE_OAUTH_TOKEN
  [ "$status" -eq 1 ]
  run env_has_value "$TMP/.env" OUTRA
  [ "$status" -eq 0 ]
  run env_has_value "$TMP/.env" NADA
  [ "$status" -eq 1 ]
}

# --- instâncias (2026-10-09): a do dono (padrão) e a do Claude (NARNIA_INSTANCE=claude), mesmo código, dados separados

@test "instância padrão: compose sem -p, dados em ./data, .env na raiz" {
  [[ "${DEV_COMPOSE[*]}" == "docker compose -f docker-compose.dev.yml" ]]
  [[ "${PROD_COMPOSE[*]}" == "docker compose -f docker-compose.yml" ]]
  [[ "$ENV_FILE" == ".env" ]]
  [[ "$NARNIA_PORT_START" == "3100" ]]
}

@test "instância claude: projetos, portas, dados e .env próprios" {
  run env NARNIA_INSTANCE=claude bash -c 'source ./start.sh; printf "%s|%s|%s|%s|%s|%s|%s|%s\n" "${DEV_COMPOSE[*]}" "${PROD_COMPOSE[*]}" "$ENV_FILE" "$NARNIA_PORT_START" "$NARNIA_DEV_PORT" "$NARNIA_DEV_API_PORT" "$NARNIA_DEV_DATA_DIR" "$NARNIA_DATA_DIR"'
  [ "$status" -eq 0 ]
  IFS='|' read -r dev prod envf start webp apip devdata proddata <<<"$output"
  [[ "$dev" == "docker compose -p narnia-claude -f docker-compose.dev.yml" ]]
  [[ "$prod" == "docker compose -p narnia-claude-prod -f docker-compose.yml" ]]
  [[ "$envf" == ".claude-data/.env" ]]
  [[ "$start" == "3250" ]]
  [[ "$webp" == "5174" && "$apip" == "3200" ]]
  [[ "$devdata" == "/app/.claude-data/dev" && "$proddata" == "./.claude-data/prod" ]]
}

@test "instância desconhecida falha com mensagem" {
  run env NARNIA_INSTANCE=xyz bash -c 'source ./start.sh'
  [ "$status" -ne 0 ]
  [[ "$output" == *"NARNIA_INSTANCE"* ]]
}

@test "dev_data_host_dir converte o caminho do container para o host" {
  NARNIA_DEV_DATA_DIR=/app/.claude-data/dev
  [[ "$(dev_data_host_dir)" == "./.claude-data/dev" ]]
  unset NARNIA_DEV_DATA_DIR
  [[ "$(dev_data_host_dir)" == "./data" ]]
}

@test "instância claude ignora NARNIA_DATA_DIR do ambiente, mas aceita NARNIA_PROVIDER" {
  run env NARNIA_INSTANCE=claude NARNIA_DATA_DIR=./data NARNIA_DEV_DATA_DIR=/app/data NARNIA_PROVIDER=claude-code \
    bash -c 'source ./start.sh; printf "%s|%s|%s\n" "$NARNIA_DATA_DIR" "$NARNIA_DEV_DATA_DIR" "$NARNIA_PROVIDER"'
  [ "$status" -eq 0 ]
  [[ "$output" == "./.claude-data/prod|/app/.claude-data/dev|claude-code" ]]
}

# --- F03-1: token do gh do computador entregue ao container (volume gh-auth), nunca por argumento nem .env

fake_gh() { # fake_gh <saida> <codigo> -> cria um `gh` falso em $TMP/bin
  mkdir -p "$TMP/bin"
  printf '#!/bin/sh\n[ "$1 $2" = "auth token" ] || exit 9\nprintf "%%s\\n" "%s"\nexit %s\n' "$1" "$2" > "$TMP/bin/gh"
  chmod +x "$TMP/bin/gh"
}

@test "host_gh_token devolve o token do gh logado no computador" {
  fake_gh "gho_tokenDoHost" 0
  run env NARNIA_GH_BIN="$TMP/bin/gh" bash -c 'source ./start.sh; host_gh_token'
  [ "$status" -eq 0 ]
  [[ "$output" == "gho_tokenDoHost" ]]
}

@test "host_gh_token falha sem login ou sem gh no computador" {
  fake_gh "" 1
  run env NARNIA_GH_BIN="$TMP/bin/gh" bash -c 'source ./start.sh; host_gh_token'
  [ "$status" -ne 0 ]
  run env NARNIA_GH_BIN="$TMP/nao-existe/gh" bash -c 'source ./start.sh; host_gh_token'
  [ "$status" -ne 0 ]
  [[ -z "$output" ]]
}

@test "api e worker montam o volume gh-auth na pasta do gh (dev e produção)" {
  for f in docker-compose.yml docker-compose.dev.yml; do
    grep -q 'gh-auth:/home/node/.config/gh' "$f"
    grep -q '^  gh-auth:' "$f"
  done
}

# --- F03-fix L1: dev-down por instância, pastas de backup e restore (incidente de 2026-10-10) ------------------------

@test "dev_down_cmd: instância padrão sem -p; instância claude com -p narnia-claude" {
  [[ "$(dev_down_cmd)" == "docker compose -f docker-compose.dev.yml --profile app down --remove-orphans" ]]
  run env NARNIA_INSTANCE=claude bash -c 'source ./start.sh; dev_down_cmd'
  [[ "$output" == *"-p narnia-claude "* ]]
}

@test "pastas de backup: ./backups no dono; ./.claude-data/... na instância claude" {
  unset NARNIA_DEV_BACKUP_DIR NARNIA_BACKUP_HOST_DIR
  [[ "$(dev_backup_host_dir)" == "./backups" ]]
  [[ "$(prod_backup_host_dir)" == "./backups" ]]
  run env NARNIA_INSTANCE=claude bash -c 'source ./start.sh; printf "%s|%s" "$(dev_backup_host_dir)" "$(prod_backup_host_dir)"'
  [[ "$output" == "./.claude-data/backups|./.claude-data/prod-backups" ]]
}

@test "resolve_backup_file aceita caminho ou nome dentro da pasta e recusa inexistente" {
  mkdir -p "$TMP/b"; : > "$TMP/b/narnia-boot-2026-10-10T08-00-00-000Z.sqlite"
  [[ "$(resolve_backup_file "$TMP/b" narnia-boot-2026-10-10T08-00-00-000Z.sqlite)" == "$TMP/b/narnia-boot-2026-10-10T08-00-00-000Z.sqlite" ]]
  [[ "$(resolve_backup_file "$TMP/b" "$TMP/b/narnia-boot-2026-10-10T08-00-00-000Z.sqlite")" == "$TMP/b/narnia-boot-2026-10-10T08-00-00-000Z.sqlite" ]]
  run resolve_backup_file "$TMP/b" nao-existe.sqlite
  [ "$status" -ne 0 ]
  [[ "$output" == *"não encontrado"* ]]
}

@test "restore_files guarda o banco atual (com WAL), troca pelo backup, apaga WAL/SHM velhos e devolve uploads" {
  mkdir -p "$TMP/data/uploads" "$TMP/b/uploads"
  printf 'atual' > "$TMP/data/narnia.sqlite"; printf 'wal' > "$TMP/data/narnia.sqlite-wal"; printf 'shm' > "$TMP/data/narnia.sqlite-shm"
  printf 'backup' > "$TMP/b/narnia-boot-x.sqlite"
  printf 'cv' > "$TMP/b/uploads/aaa.pdf"; printf 'ja' > "$TMP/data/uploads/bbb.pdf"
  restore_files "$TMP/data" "$TMP/b" "$TMP/b/narnia-boot-x.sqlite" STAMP
  [[ "$(cat "$TMP/data/narnia.sqlite")" == "backup" ]]
  [ ! -e "$TMP/data/narnia.sqlite-wal" ]
  [ ! -e "$TMP/data/narnia.sqlite-shm" ]
  [[ "$(cat "$TMP/b/narnia-before-restore-STAMP.sqlite")" == "atual" ]]
  [[ "$(cat "$TMP/b/narnia-before-restore-STAMP.sqlite-wal")" == "wal" ]]
  [[ "$(cat "$TMP/data/uploads/aaa.pdf")" == "cv" ]]
  [[ "$(cat "$TMP/data/uploads/bbb.pdf")" == "ja" ]]
}

@test "restore_files devolve os templates de CV enviados (F05) que faltam, sem sobrescrever" {
  mkdir -p "$TMP/data/templates" "$TMP/b/templates"
  printf 'backup' > "$TMP/b/narnia-boot-x.sqlite"
  printf 'zip1' > "$TMP/b/templates/t1.zip"; printf 'zip2-backup' > "$TMP/b/templates/t2.zip"
  printf 'zip2-atual' > "$TMP/data/templates/t2.zip"
  restore_files "$TMP/data" "$TMP/b" "$TMP/b/narnia-boot-x.sqlite" STAMP
  [[ "$(cat "$TMP/data/templates/t1.zip")" == "zip1" ]]
  [[ "$(cat "$TMP/data/templates/t2.zip")" == "zip2-atual" ]]
}

# --- regressão 2026-10-10: instância do dono subiu com imagem antiga (sem gh) e volume gh-auth com dono root ---------

docker_spy() { # substitui o docker por um registrador de chamadas em $TMP/calls
  : > "$TMP/calls"
  docker() { printf '%s\n' "$*" >> "$TMP/calls"; }
  require_docker() { :; }
}

@test "dev reconstrói as imagens antes de instalar dependências, entregar o token e subir" {
  docker_spy
  export NARNIA_GH_BIN="$TMP/nao-existe/gh"
  main dev -d >/dev/null 2>&1
  first=$(head -n 1 "$TMP/calls")
  [[ "$first" == *"--profile app build"* ]]
  grep -q -- "--profile app up -d" "$TMP/calls"
}

@test "deliver_host_gh_token corrige o dono da pasta do gh como root antes de gravar o token" {
  docker_spy
  fake_gh "gho_tokenDoHost" 0
  export NARNIA_GH_BIN="$TMP/bin/gh"
  deliver_host_gh_token docker compose -f docker-compose.dev.yml dev >/dev/null
  chown_line=$(grep -n -- "--user root" "$TMP/calls" | head -n 1 | cut -d: -f1)
  write_line=$(grep -n -- "host-token" "$TMP/calls" | head -n 1 | cut -d: -f1)
  [[ -n "$chown_line" && -n "$write_line" ]]
  grep -q "chown node:node /home/node/.config/gh" "$TMP/calls"
  (( chown_line < write_line ))
}

@test "api e worker rodam com init (tini como PID 1 recolhe processos claude mortos; plano de comunicação C3)" {
  for f in docker-compose.yml docker-compose.dev.yml; do
    for svc in api worker; do
      run docker_compose_service_has_init "$f" "$svc"
      [ "$status" -eq 0 ] || { echo "$f:$svc sem init: true"; return 1; }
    done
  done
}

# --- plano de comunicação C7 / CM-4: cópia separada do código para a instância do dono (.owner-src) --------------------

@test "instância do dono usa .owner-src como código quando a pasta existe; sem ela, a raiz" {
  mkdir -p "$TMP/src"
  # o setup já carregou o start.sh: com a .owner-src real presente (depois do 1º promote), NARNIA_SRC_DIR vem exportada
  run env -u NARNIA_SRC_DIR NARNIA_OWNER_SRC_DIR="$TMP/src" bash -c 'source ./start.sh; printf "%s" "$NARNIA_SRC_DIR"'
  [[ "$output" == "$TMP/src" ]]
  run env -u NARNIA_SRC_DIR NARNIA_OWNER_SRC_DIR="$TMP/nao-existe" bash -c 'source ./start.sh; printf "%s" "${NARNIA_SRC_DIR:-.}"'
  [[ "$output" == "." ]]
}

@test "instância claude nunca usa .owner-src e monta os dados da própria pasta" {
  mkdir -p "$TMP/src"
  run env NARNIA_INSTANCE=claude NARNIA_OWNER_SRC_DIR="$TMP/src" \
    bash -c 'source ./start.sh; printf "%s|%s|%s" "$NARNIA_SRC_DIR" "$NARNIA_DATA_MOUNT" "$NARNIA_BACKUP_MOUNT"'
  [[ "$output" == ".|./.claude-data/dev|./.claude-data/backups" ]]
}

@test "compose de dev monta o código de NARNIA_SRC_DIR e dados/backups da raiz por variável" {
  grep -q '\${NARNIA_SRC_DIR:-.}:/app' docker-compose.dev.yml
  grep -q '\${NARNIA_DATA_MOUNT:-./data}:/app/data' docker-compose.dev.yml
  grep -q '\${NARNIA_BACKUP_MOUNT:-./backups}:/app/backups' docker-compose.dev.yml
}

git_repo() { # git_repo DIR -> repositório git com um commit
  mkdir -p "$1" && git -C "$1" init -q && git -C "$1" config user.email t@t && git -C "$1" config user.name t
  echo a > "$1/a.txt" && git -C "$1" add a.txt && git -C "$1" commit -qm um
}

@test "promote cria .owner-src no HEAD e depois move para o commit novo" {
  git_repo "$TMP/repo"
  run bash -c "cd '$TMP/repo' && source '$BATS_TEST_DIRNAME/../../start.sh' && cmd_promote"
  [ "$status" -eq 0 ]
  [[ "$(git -C "$TMP/repo/.owner-src" rev-parse HEAD)" == "$(git -C "$TMP/repo" rev-parse HEAD)" ]]
  echo b > "$TMP/repo/b.txt" && git -C "$TMP/repo" add b.txt && git -C "$TMP/repo" commit -qm dois
  run bash -c "cd '$TMP/repo' && source '$BATS_TEST_DIRNAME/../../start.sh' && cmd_promote"
  [ "$status" -eq 0 ]
  [[ "$(git -C "$TMP/repo/.owner-src" rev-parse HEAD)" == "$(git -C "$TMP/repo" rev-parse HEAD)" ]]
  [[ "$output" == *"make dev-down && make dev"* ]]
}

@test "promote recusa árvore suja e recusa rodar pela instância claude" {
  git_repo "$TMP/repo"
  echo mudou > "$TMP/repo/a.txt"
  run bash -c "cd '$TMP/repo' && source '$BATS_TEST_DIRNAME/../../start.sh' && cmd_promote"
  [ "$status" -ne 0 ]
  [[ "$output" == *"alterações não commitadas"* ]]
  git -C "$TMP/repo" checkout -q a.txt
  run bash -c "cd '$TMP/repo' && export NARNIA_INSTANCE=claude && source '$BATS_TEST_DIRNAME/../../start.sh' && cmd_promote"
  [ "$status" -ne 0 ]
  [[ "$output" == *"dono"* ]]
}

# --- F12 · extensão do Chrome (F12-10): ./start.sh extension e o promote gera junto -------------------------------

@test "extension gera a extensão no código de NARNIA_SRC_DIR e diz a pasta" {
  mkdir -p "$TMP/src/apps/extension" && echo '{}' > "$TMP/src/apps/extension/package.json"
  run bash -c "source '$BATS_TEST_DIRNAME/../../start.sh'; require_docker() { :; }; dev_run() { echo \"RUN SRC=\$NARNIA_SRC_DIR \$*\"; }; NARNIA_SRC_DIR='$TMP/src' cmd_extension"
  [ "$status" -eq 0 ]
  [[ "$output" == *"RUN SRC=$TMP/src"*"@narnia-jobs/extension build"* ]]
  [[ "$output" == *"$TMP/src/apps/extension/dist"* ]]
}

@test "extension recusa código sem apps/extension" {
  run bash -c "source '$BATS_TEST_DIRNAME/../../start.sh'; require_docker() { :; }; NARNIA_SRC_DIR='$TMP/vazio' cmd_extension"
  [ "$status" -ne 0 ]
  [[ "$output" == *"apps/extension"* ]]
}

@test "promote gera a extensão no .owner-src; se falhar, só avisa" {
  git_repo "$TMP/repo"
  mkdir -p "$TMP/repo/apps/extension" && echo '{}' > "$TMP/repo/apps/extension/package.json"
  git -C "$TMP/repo" add apps && git -C "$TMP/repo" commit -qm ext
  run bash -c "cd '$TMP/repo' && source '$BATS_TEST_DIRNAME/../../start.sh' && extension_build() { echo \"\$1\" > '$TMP/built'; } && cmd_promote"
  [ "$status" -eq 0 ]
  [[ "$(cat "$TMP/built")" == "./.owner-src" ]]
  [[ "$output" == *"Recarregar"* ]]
  run bash -c "cd '$TMP/repo' && source '$BATS_TEST_DIRNAME/../../start.sh' && extension_build() { return 1; } && cmd_promote"
  [ "$status" -eq 0 ]
  [[ "$output" == *"./start.sh extension"* ]]
}

# --- F04/M5 · modo B: install-plugin e diagnóstico no host (claude falso, HOME temporário) ---------------------------

fake_claude() { # registra cada chamada em $TMP/claude.calls; respostas configuráveis por $TMP/claude.mcpget e .pluginlist
  mkdir -p "$TMP/bin"
  cat > "$TMP/bin/claude" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_DIR/claude.calls"
case "$1 $2" in
  "mcp get") [ -f "$FAKE_DIR/claude.mcpget" ] && cat "$FAKE_DIR/claude.mcpget" && exit 0; exit 1 ;;
  "plugin list") [ -f "$FAKE_DIR/claude.pluginlist" ] && cat "$FAKE_DIR/claude.pluginlist"; exit 0 ;;
esac
exit 0
SH
  chmod +x "$TMP/bin/claude"
  export FAKE_DIR="$TMP" NARNIA_CLAUDE_BIN="$TMP/bin/claude"
  : > "$TMP/claude.calls"
}

fake_agent() { # o agente vem da api (rota persona-card?format=agent); aqui, uma resposta fixa no formato dela
  plugin_agent() { printf -- '---\nname: recrutador\ntools: mcp__%s__*, WebSearch, WebFetch\n---\n\ncorpo renderizado\n' "$3"; }
}

@test "plugin_endpoint dev: porta e token da instância corrente (dono 3100/dev-token; claude 3200/claude-token)" {
  unset NARNIA_DEV_API_PORT NARNIA_TOKEN
  [[ "$(plugin_endpoint dev)" == "http://127.0.0.1:3100|dev-token" ]]
  run env NARNIA_INSTANCE=claude bash -c 'source ./start.sh; plugin_endpoint dev'
  [[ "$output" == "http://127.0.0.1:3200|claude-token" ]]
}

@test "nomes do modo B por instância: o Claude nunca usa o nome do servidor e do marketplace do dono" {
  [[ "$(mcp_server_name)" == "narnia-jobs" && "$(plugin_marketplace_name)" == "narnia-jobs-local" ]]
  run env NARNIA_INSTANCE=claude bash -c 'source ./start.sh; printf "%s|%s|%s" "$(mcp_server_name)" "$(plugin_marketplace_name)" "$(plugin_stage_dir)"'
  [[ "$output" == "narnia-jobs-claude|narnia-jobs-claude-local|./.claude-data/plugin-build" ]]
}

@test "stage_plugin copia o plugin, grava .narnia-env 0600 e o marketplace local, sem .mcp.json no plugin instalado" {
  fake_agent
  stage_plugin ./plugin "$TMP/stage" "http://127.0.0.1:3200" "claude-token" "narnia-jobs-claude-local" narnia-jobs-claude
  [ -f "$TMP/stage/plugin/.claude-plugin/plugin.json" ]
  [ -f "$TMP/stage/plugin/hooks/session-start.sh" ]
  grep -qx "NARNIA_API_URL=http://127.0.0.1:3200" "$TMP/stage/plugin/.narnia-env"
  grep -qx "NARNIA_TOKEN=claude-token" "$TMP/stage/plugin/.narnia-env"
  [[ "$(stat -c %a "$TMP/stage/plugin/.narnia-env")" == "600" ]]
  [ ! -e "$TMP/stage/plugin/.mcp.json" ]
  grep -q '"name": "narnia-jobs-claude-local"' "$TMP/stage/.claude-plugin/marketplace.json"
  grep -q '"source": "./plugin"' "$TMP/stage/.claude-plugin/marketplace.json"
  # auditoria C: agente renderizado pela api (sem placeholder), cabeçalho do MCP em arquivo 0600, sem o template
  grep -qx 'tools: mcp__narnia-jobs-claude__\*, WebSearch, WebFetch' "$TMP/stage/plugin/agents/recrutador.md"
  ! grep -rq '{{' "$TMP/stage"
  [ ! -e "$TMP/stage/plugin/.mcp.json.template" ]
  [[ "$(cat "$TMP/stage/mcp-headers.json")" == '{"Authorization":"Bearer claude-token"}' ]]
  [[ "$(stat -c %a "$TMP/stage/mcp-headers.json")" == "600" ]]
}

@test "stage_plugin falha sem o agente da api (instância fora do ar) e não deixa o agente cru" {
  plugin_agent() { return 1; }
  run stage_plugin ./plugin "$TMP/stage" "http://127.0.0.1:9" "tok" "narnia-jobs-local" narnia-jobs
  [ "$status" -ne 0 ]
  [[ "$output" == *"agente do recrutador"* ]]
}

@test "install_plugin_with registra o MCP no escopo user e instala o plugin pelo marketplace local, idempotente" {
  fake_claude; fake_agent
  stage_plugin ./plugin "$TMP/stage" "http://127.0.0.1:3100" "dev-token" "narnia-jobs-local" narnia-jobs
  install_plugin_with "$TMP/stage" narnia-jobs "http://127.0.0.1:3100" narnia-jobs-local >/dev/null
  install_plugin_with "$TMP/stage" narnia-jobs "http://127.0.0.1:3100" narnia-jobs-local >/dev/null
  grep -qx "mcp remove -s user narnia-jobs" "$TMP/claude.calls"
  # auditoria C: o token não vai na linha de comando; o Claude Code lê o cabeçalho do arquivo 0600 pelo headersHelper
  grep -qxF "mcp add-json -s user narnia-jobs {\"type\":\"http\",\"url\":\"http://127.0.0.1:3100/mcp\",\"headersHelper\":\"cat '$TMP/stage/mcp-headers.json'\"}" "$TMP/claude.calls"
  ! grep -q "dev-token" "$TMP/claude.calls"
  grep -qx "plugin marketplace add $TMP/stage --scope user" "$TMP/claude.calls"
  grep -qx "plugin uninstall narnia-jobs@narnia-jobs-local" "$TMP/claude.calls"
  grep -qx "plugin install narnia-jobs@narnia-jobs-local --scope user" "$TMP/claude.calls"
  [[ "$(grep -c '^mcp add-json' "$TMP/claude.calls")" == "2" ]]
}

@test "porta mudou: reinstalar grava a URL nova no MCP e no .narnia-env" {
  fake_claude; fake_agent
  stage_plugin ./plugin "$TMP/stage" "http://127.0.0.1:3101" "tok" "narnia-jobs-local" narnia-jobs
  install_plugin_with "$TMP/stage" narnia-jobs "http://127.0.0.1:3101" narnia-jobs-local >/dev/null
  grep -q 'mcp add-json -s user narnia-jobs {"type":"http","url":"http://127.0.0.1:3101/mcp"' "$TMP/claude.calls"
  grep -qx "NARNIA_API_URL=http://127.0.0.1:3101" "$TMP/stage/plugin/.narnia-env"
}

@test "plugin_doctor: ok com MCP na porta certa e plugin instalado; acusa porta mudou e plugin ausente" {
  fake_claude
  printf 'narnia-jobs:\n  Type: http\n  URL: http://127.0.0.1:3100/mcp\n' > "$TMP/claude.mcpget"
  printf '[{"id":"narnia-jobs@narnia-jobs-local","enabled":true}]\n' > "$TMP/claude.pluginlist"
  run plugin_doctor narnia-jobs "http://127.0.0.1:3100" narnia-jobs-local
  [ "$status" -eq 0 ]
  [[ "$output" == *"MCP narnia-jobs: ok"* && "$output" == *"plugin narnia-jobs@narnia-jobs-local: instalado"* ]]
  printf 'narnia-jobs:\n  URL: http://127.0.0.1:3999/mcp\n' > "$TMP/claude.mcpget"
  : > "$TMP/claude.pluginlist"
  run plugin_doctor narnia-jobs "http://127.0.0.1:3100" narnia-jobs-local
  [ "$status" -ne 0 ]
  [[ "$output" == *"porta mudou"* && "$output" == *"install-plugin"* && "$output" == *"não instalado"* ]]
}

# --- F04/M5 · Arize Phoenix (F04-15): ligado no dev, perfil opcional na produção, portas por instância, e2e sem ---

@test "Phoenix no dev: imagem fixada, ligado por padrão, só em 127.0.0.1 e api/worker exportando para ele" {
  run awk '/^  phoenix:/{f=1;next} f&&/^  [a-z-]+:$/{f=0} f' docker-compose.dev.yml
  [[ "$output" == *"arizephoenix/phoenix:version-20.21.0-nonroot"* ]]
  [[ "$output" != *"profiles:"* ]]
  [[ "$output" == *'127.0.0.1:${NARNIA_PHOENIX_PORT:-6006}:6006'* ]]
  [[ "$output" == *'127.0.0.1:${NARNIA_PHOENIX_GRPC_PORT:-4317}:4317'* ]]
  grep -q 'NARNIA_OTEL_ENDPOINT=${NARNIA_OTEL_ENDPOINT-http://phoenix:6006/v1/traces}' docker-compose.dev.yml
  grep -q '^  phoenix-data:' docker-compose.dev.yml
}

@test "Phoenix na produção: só com o perfil observability e exportador desligado por padrão" {
  run awk '/^  phoenix:/{f=1;next} f&&/^[a-z]/{f=0} f' docker-compose.yml
  [[ "$output" == *'profiles: ["observability"]'* ]]
  [[ "$output" == *"arizephoenix/phoenix:version-20.21.0-nonroot"* ]]
  grep -q 'NARNIA_OTEL_ENDPOINT=${NARNIA_OTEL_ENDPOINT:-}' docker-compose.yml
}

@test "e2e nunca exporta rastros e a instância claude usa portas próprias do Phoenix" {
  grep -q 'NARNIA_OTEL_ENDPOINT=$' docker-compose.e2e.yml
  run env NARNIA_INSTANCE=claude bash -c 'source ./start.sh; printf "%s|%s" "$NARNIA_PHOENIX_PORT" "$NARNIA_PHOENIX_GRPC_PORT"'
  [[ "$output" == "6106|4417" ]]
}

@test "smoke do modo B (E2E-09): recusa sem --yes e monta a cópia com .mcp.json da instância claude" {
  run bash scripts/smoke-plugin.sh
  [ "$status" -ne 0 ]
  [[ "$output" == *"--yes"* ]]
  run bash -c 'source scripts/smoke-plugin.sh; plugin_agent() { printf -- "---\nname: recrutador\n---\n"; }; smoke_stage "$1"; cat "$1/plugin/.mcp.json"' _ "$TMP/smoke"
  [[ "$output" == *'"url": "http://127.0.0.1:3200/mcp"'* && "$output" == *"claude-token"* ]]
}

@test "auditoria C: a cópia do plugin com token (.plugin-build) não entra no contexto de build do Docker" {
  grep -qx '.plugin-build' .dockerignore
  # o `!plugin/**` não pode reincluir a cópia (ela fica em .plugin-build/plugin)
  ! grep -qx '!.plugin-build' .dockerignore
}

# --- avaliações no Phoenix (M5): ./start.sh evals prompts ---------------------------------------------------------

@test "evals prompts roda no api de dev quando ele está no ar, repassando os argumentos" {
  : > "$TMP/calls"
  docker() {
    printf '%s\n' "$*" >> "$TMP/calls"
    [[ "$*" == *"ps -q api"* ]] && echo "abc123"
    return 0
  }
  require_docker() { :; }
  run cmd_evals prompts extract-facts --strict
  [ "$status" -eq 0 ]
  grep -q -- "exec -T api pnpm --filter @narnia-jobs/api exec tsx src/cli.ts evals prompts extract-facts --strict" "$TMP/calls"
}

@test "evals sem 'prompts' mostra o uso; sem a aplicação no ar pede para subir" {
  docker() { return 0; }
  require_docker() { :; }
  run cmd_evals
  [ "$status" -ne 0 ]
  [[ "$output" == *"evals prompts"* ]]
  run cmd_evals prompts
  [ "$status" -ne 0 ]
  [[ "$output" == *"suba a aplicação"* ]]
}

@test "evals chat (banco temporário isolado) também passa pelo api de dev" {
  : > "$TMP/calls"
  docker() {
    printf '%s\n' "$*" >> "$TMP/calls"
    [[ "$*" == *"ps -q api"* ]] && echo "abc123"
    return 0
  }
  require_docker() { :; }
  run cmd_evals chat pontos-fracos
  [ "$status" -eq 0 ]
  grep -q -- "src/cli.ts evals chat pontos-fracos" "$TMP/calls"
}
