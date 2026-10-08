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
