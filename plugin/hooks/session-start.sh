#!/usr/bin/env bash
# narnia-jobs · hook SessionStart (F04-1). Entrega ao Claude Code a persona do recrutador e o cartão do perfil ativo.
# Modo A (chat web): a sessão já recebeu o cartão no system prompt (NARNIA_SESSION_HAS_CARD=1) → não faz nada.
# Modo B (terminal): busca na API da instância; porta e token vêm do ambiente ou do .narnia-env gerado pelo
# install-plugin. Nunca falha a sessão: com a API fora, imprime um aviso visível (o modelo também o recebe).
set -u

[ "${NARNIA_SESSION_HAS_CARD:-}" = "1" ] && exit 0

root=${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}
if [ -z "${NARNIA_API_URL:-}" ] || [ -z "${NARNIA_TOKEN:-}" ]; then
  if [ -f "$root/.narnia-env" ]; then
    while IFS='=' read -r k v; do
      case "$k" in
        NARNIA_API_URL) [ -z "${NARNIA_API_URL:-}" ] && NARNIA_API_URL=$v ;;
        NARNIA_TOKEN) [ -z "${NARNIA_TOKEN:-}" ] && NARNIA_TOKEN=$v ;;
      esac
    done < "$root/.narnia-env"
  fi
fi

warn() {
  printf '⚠ narnia-jobs fora do ar (%s): o recrutador está sem o seu perfil nesta sessão.\n' "$1"
  printf 'Suba o narnia-jobs (./start.sh up ou make dev) e rode /narnia-jobs:perfil para recarregar.\n'
  exit 0
}

[ -n "${NARNIA_API_URL:-}" ] && [ -n "${NARNIA_TOKEN:-}" ] || warn "porta e token não configurados; rode narnia-jobs install-plugin"
command -v curl >/dev/null 2>&1 || warn "curl não encontrado"

# formato texto: o corpo é o prompt pronto (sem jq/node no computador do usuário; o JSON trazia o texto escapado)
text=$(curl -fsS -m 5 -H "Authorization: Bearer ${NARNIA_TOKEN}" \
  "${NARNIA_API_URL}/api/profiles/active/persona-card?format=text" 2>/dev/null) \
  || warn "${NARNIA_API_URL} não respondeu"
[ -n "$text" ] || warn "resposta vazia de ${NARNIA_API_URL}"
printf '%s\n' "$text"
