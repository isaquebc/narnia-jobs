#!/usr/bin/env bash
# narnia-jobs · vigia de avisos no host (F15-3, plans/plan-v0/tasks/F15-tarefas-e-avisos.md §2.2). Pergunta à api local
# pelos avisos novos (tarefa nova, prazo perto, prazo vencido, entrevista) e mostra a notificação nativa do sistema:
# `notify-send` no Linux, `osascript` no macOS. Sem Node: só bash e curl. Subido e parado pelo ./start.sh.
#
# Uso: narnia-notify.sh run|once
# Ambiente: NARNIA_NOTIFY_API (ex.: http://127.0.0.1:3100), NARNIA_NOTIFY_TOKEN, NARNIA_NOTIFY_WEB (endereço da
# interface, para o clique), NARNIA_NOTIFY_STATE (pasta do cursor), NARNIA_NOTIFY_INTERVAL (segundos, padrão 20).
# O token vem pelo ambiente (nunca pela linha de comando, que outros usuários veem no `ps`).
set -uo pipefail

API=${NARNIA_NOTIFY_API:?NARNIA_NOTIFY_API}
TOKEN=${NARNIA_NOTIFY_TOKEN:?NARNIA_NOTIFY_TOKEN}
WEB=${NARNIA_NOTIFY_WEB:-$API}
STATE=${NARNIA_NOTIFY_STATE:?NARNIA_NOTIFY_STATE}
INTERVAL=${NARNIA_NOTIFY_INTERVAL:-20}
CURSOR_FILE="$STATE/cursor"

# só a api local: o vigia nunca fala com outro endereço
case "$API" in
  http://127.0.0.1:* | http://localhost:*) ;;
  *) printf 'narnia-notify: só a api local (127.0.0.1); recebi %s\n' "$API" >&2; exit 2 ;;
esac

notifier() {
  if command -v notify-send >/dev/null 2>&1; then echo notify-send
  elif command -v osascript >/dev/null 2>&1; then echo osascript
  else echo none; fi
}

# show TITLE BODY URL URGENT -> notificação nativa; o clique abre a tarefa onde o sistema deixa
show() {
  local title=$1 body=$2 url=$3 urgent=$4
  case "$(notifier)" in
    notify-send)
      local level=normal
      [[ "$urgent" == true ]] && level=critical
      # --action (libnotify ≥ 0.7.9) espera o clique; em segundo plano, para não travar o laço
      if notify-send --help 2>/dev/null | grep -q -- '--action'; then
        (
          choice=$(notify-send --app-name=narnia-jobs --urgency="$level" --action=open=Abrir --wait \
            "$title" "$body" 2>/dev/null) || true
          if [[ "$choice" == open ]] && command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1; fi
        ) &
      else
        notify-send --app-name=narnia-jobs --urgency="$level" "$title" "$body${body:+$'\n'}$url"
      fi ;;
    osascript)
      osascript - "$title" "$body" <<'OSA' >/dev/null 2>&1 || true
on run argv
  display notification (item 2 of argv) with title "narnia-jobs" subtitle (item 1 of argv)
end run
OSA
      ;;
  esac
}

# poll -> uma volta: a api responde em texto (1ª linha o cursor; depois título, corpo, link e urgente por tabulação)
poll() {
  local cursor="" url text line title body link urgent
  [[ -f "$CURSOR_FILE" ]] && cursor=$(cat "$CURSOR_FILE")
  url="$API/api/notifications/native?format=text"
  [[ -n "$cursor" ]] && url="$url&after=$(printf '%s' "$cursor" | sed 's/:/%3A/g; s/+/%2B/g')"
  text=$(curl -fsS --max-time 10 -H "authorization: Bearer $TOKEN" "$url" 2>/dev/null) || return 1
  local first=1
  while IFS= read -r line; do
    if [[ $first == 1 ]]; then
      first=0
      [[ -n "$line" ]] && printf '%s' "$line" > "$CURSOR_FILE.tmp" && mv "$CURSOR_FILE.tmp" "$CURSOR_FILE"
      continue
    fi
    [[ -n "$line" ]] || continue
    # campo a campo (com IFS de tabulação, campos vazios se juntariam: o corpo pode vir vazio)
    title=${line%%$'\t'*}; line=${line#*$'\t'}
    body=${line%%$'\t'*}; line=${line#*$'\t'}
    link=${line%%$'\t'*}; urgent=${line#*$'\t'}
    show "$title" "$body" "${WEB%/}${link}" "$urgent"
  done <<<"$text"
}

mkdir -p "$STATE"
case "${1:-run}" in
  once) poll ;;
  run)
    if [[ "$(notifier)" == none ]]; then
      printf 'narnia-notify: sem notify-send (Linux: pacote libnotify-bin) nem osascript; os avisos ficam só no narnia.\n' >&2
      exit 0
    fi
    while :; do poll || true; sleep "$INTERVAL"; done ;;
  *) printf 'uso: narnia-notify.sh run|once\n' >&2; exit 2 ;;
esac
