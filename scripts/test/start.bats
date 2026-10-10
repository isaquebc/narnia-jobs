#!/usr/bin/env bats
# Testes do lançador start.sh (funções puras). Rodar com: ./start.sh test:sh (bats dentro da imagem de dev)

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
