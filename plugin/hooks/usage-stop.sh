#!/usr/bin/env bash
# narnia-jobs · hook Stop (auditoria C, F04 §2.3): registra no medidor do app o uso das sessões do Claude Code no
# terminal (modo B). Relê o transcript da sessão (caminho e id chegam em JSON pela entrada padrão) e manda à API uma
# linha por mensagem do assistente: id, modelo e tokens. Só números saem do transcript; o app ignora o que já contou.
# Modo A (chat web): o app já mede pelo SDK, então não faz nada. Nunca atrapalha a sessão: sem saída, sempre 0.
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
[ -n "${NARNIA_API_URL:-}" ] && [ -n "${NARNIA_TOKEN:-}" ] || exit 0
command -v curl >/dev/null 2>&1 || exit 0

input=$(cat)
field() { printf '%s' "$input" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1; }
session=$(field session_id)
# caminho do Windows chega com a barra invertida escapada no JSON
transcript=$(field transcript_path | sed 's/\\\\/\\/g')
[ -n "$session" ] && [ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

# uma linha por mensagem (o transcript repete a mesma mensagem a cada bloco de conteúdo), na ordem da primeira aparição;
# só chaves fora de strings casam (dentro do texto as aspas vêm escapadas)
awk '
  index($0, "\"type\":\"assistant\"") == 0 { next }
  {
    if (!match($0, /"id":"msg_[A-Za-z0-9_-]+"/)) next
    id = substr($0, RSTART + 6, RLENGTH - 7)
    model = "desconhecido"
    if (match($0, /"model":"[^"]+"/)) model = substr($0, RSTART + 9, RLENGTH - 10)
    in_t = num("\"input_tokens\":"); out_t = num("\"output_tokens\":")
    cr = num("\"cache_read_input_tokens\":"); cw = num("\"cache_creation_input_tokens\":")
    if (!(id in seen)) { seen[id] = 1; order[++n] = id }
    line[id] = id "\t" model "\t" in_t "\t" out_t "\t" cr "\t" cw
  }
  function num(key,   re) {
    re = key "[0-9]+"
    if (!match($0, re)) return 0
    return substr($0, RSTART + length(key), RLENGTH - length(key)) + 0
  }
  END { for (i = 1; i <= n; i++) print line[order[i]] }
' "$transcript" 2>/dev/null \
  | curl -fsS -m 5 -o /dev/null -X POST -H "Authorization: Bearer ${NARNIA_TOKEN}" \
      -H "Content-Type: text/plain" --data-binary @- \
      "${NARNIA_API_URL}/api/usage/terminal?session=${session}" >/dev/null 2>&1
exit 0
