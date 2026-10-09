#!/usr/bin/env bats
# Testes da ferramenta do ambiente de testes do Claude (scripts/claude-env.sh): partes puras, sem Docker.

setup() {
  export NARNIA_CLAUDE_ENV_NO_MAIN=1
  source "$BATS_TEST_DIRNAME/../claude-env.sh"
}

@test "força a instância claude mesmo sem NARNIA_INSTANCE no ambiente" {
  [[ "$NARNIA_INSTANCE" == "claude" ]]
  [[ "${DEV_COMPOSE[*]}" == "docker compose -p narnia-claude -f docker-compose.dev.yml" ]]
}

@test "base da API e URL da interface apontam para as portas do Claude" {
  [[ "$(api_base)" == "http://127.0.0.1:3200" ]]
  [[ "$(ui_url)" == "http://127.0.0.1:5174/?token=claude-token" ]]
}

@test "guarda recusa projeto que não seja o do Claude" {
  run bash -c 'export NARNIA_CLAUDE_ENV_NO_MAIN=1; source scripts/claude-env.sh; DEV_COMPOSE=(docker compose -f docker-compose.dev.yml); assert_claude_project'
  [ "$status" -ne 0 ]
  [[ "$output" == *"recusado"* ]]
}

@test "guarda aceita o projeto do Claude" {
  run assert_claude_project
  [ "$status" -eq 0 ]
}

@test "pasta de dados do Claude nunca é ./data" {
  [[ "$(claude_data_dir)" == "./.claude-data/dev" ]]
}

@test "help lista os subcomandos principais" {
  run usage
  [[ "$output" == *"up"* && "$output" == *"reset"* && "$output" == *"seed"* && "$output" == *"api"* && "$output" == *"wipe"* ]]
}
