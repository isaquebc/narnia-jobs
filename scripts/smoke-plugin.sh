#!/usr/bin/env bash
# narnia-jobs · E2E-09 (F04): smoke do modo B com o Claude Code REAL do computador, contra a instância de testes do
# Claude (porta 3200). Usa a assinatura de quem roda e não instala nada: carrega o plugin por --plugin-dir a partir de
# uma cópia temporária com .mcp.json e .narnia-env da instância. Só sob demanda: exige --yes. Nunca na CI comum.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
export NARNIA_INSTANCE=claude
# shellcheck source=../start.sh
source ./start.sh

smoke_stage() { # smoke_stage DIR -> cópia do plugin com .mcp.json (servidor da instância) para --plugin-dir
  local dir=$1 ep url token
  ep=$(plugin_endpoint dev); url=${ep%%|*}; token=${ep#*|}
  stage_plugin ./plugin "$dir" "$url" "$token" "$(plugin_marketplace_name)"
  cat > "$dir/plugin/.mcp.json" <<JSON
{ "mcpServers": { "narnia-jobs": { "type": "http", "url": "$url/mcp", "headers": { "Authorization": "Bearer $token" } } } }
JSON
}

main_smoke() {
  [[ "${1:-}" == --yes ]] || die "o smoke usa a sua assinatura do Claude (poucos tokens). Rode com --yes para confirmar."
  local dir bin=${NARNIA_CLAUDE_BIN:-claude} out
  dir=$(mktemp -d)
  smoke_stage "$dir"
  out=$("$bin" -p "/narnia-jobs:perfil" --max-turns 2 --plugin-dir "$dir/plugin" 2>&1) || true
  rm -rf "$dir"
  printf '%s\n' "$out"
  grep -q -i -E 'cartão|perfil|Ana Maria' <<<"$out" || die "o recrutador não devolveu o cartão do perfil."
  info "E2E-09 ok: o Claude Code carregou o plugin e leu o cartão pela instância de testes."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main_smoke "$@"; fi
