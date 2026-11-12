#!/usr/bin/env bats
# F15-3 · vigia de avisos (scripts/notify/narnia-notify.sh) e a ligação com o start.sh. A api é um servidor Node falso e o
# notify-send é um script falso que grava os argumentos: nada aparece na tela. Rodar com ./start.sh test:sh.

NOTIFY="$BATS_TEST_DIRNAME/../notify/narnia-notify.sh"

setup() {
  TMP=$(mktemp -d)
  mkdir -p "$TMP/bin"
  # notify-send falso (sem --action, como o libnotify antigo): grava os argumentos
  cat > "$TMP/bin/notify-send" <<'SH'
#!/usr/bin/env bash
[[ "${1:-}" == --help ]] && { echo "Usage: notify-send [OPTION…] <SUMMARY> [BODY]"; exit 0; }
printf '%s\n' "$*" >> "$NOTIFY_LOG"
SH
  chmod +x "$TMP/bin/notify-send"
  export NOTIFY_LOG="$TMP/shown" PATH="$TMP/bin:$PATH"
  PORT=$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
  # api falsa (formato texto): sem `after`, só o cursor; com `after`, um aviso urgente e o cursor novo; token errado, 401
  node -e "
    require('http').createServer((q, r) => {
      if (q.headers.authorization !== 'Bearer tk') { r.writeHead(401); return r.end(); }
      const u = new URL(q.url, 'http://x');
      if (u.searchParams.get('format') !== 'text') { r.writeHead(400); return r.end(); }
      if (!u.searchParams.get('after')) return r.end('2026-11-12T12:00:00.000Z\\n');
      r.end('2026-11-12T12:05:00.000Z\\nTarefa vencida: Triagem\\tAcme · Venceu\\t/tarefas?id=t1\\ttrue\\n');
    }).listen($PORT, '127.0.0.1');
  " &
  API_PID=$!
  for _ in $(seq 1 30); do curl -fs -o /dev/null -H 'authorization: Bearer tk' "http://127.0.0.1:$PORT/" && break; sleep 0.1; done
  export NARNIA_NOTIFY_API="http://127.0.0.1:$PORT" NARNIA_NOTIFY_TOKEN=tk \
    NARNIA_NOTIFY_WEB="http://127.0.0.1:5173" NARNIA_NOTIFY_STATE="$TMP/state"
}

teardown() {
  kill "$API_PID" 2>/dev/null || true
  [[ -f "$TMP/state/notify.pid" ]] && kill "$(cat "$TMP/state/notify.pid")" 2>/dev/null || true
  rm -rf "$TMP"
}

@test "primeira vez: guarda o cursor e não mostra nada (nada do histórico)" {
  run bash "$NOTIFY" once
  [ "$status" -eq 0 ]
  [ "$(cat "$TMP/state/cursor")" = "2026-11-12T12:00:00.000Z" ]
  [ ! -f "$NOTIFY_LOG" ]
}

@test "com cursor: mostra o aviso (urgente = critical, com o link da tarefa) e avança o cursor" {
  bash "$NOTIFY" once
  run bash "$NOTIFY" once
  [ "$status" -eq 0 ]
  grep -q -- "--urgency=critical Tarefa vencida: Triagem Acme · Venceu" "$NOTIFY_LOG"
  grep -q "http://127.0.0.1:5173/tarefas?id=t1" "$NOTIFY_LOG"
  [ "$(cat "$TMP/state/cursor")" = "2026-11-12T12:05:00.000Z" ]
}

@test "token errado: falha sem mostrar nem mexer no cursor" {
  NARNIA_NOTIFY_TOKEN=errado run bash "$NOTIFY" once
  [ "$status" -ne 0 ]
  [ ! -f "$TMP/state/cursor" ]
  [ ! -f "$NOTIFY_LOG" ]
}

@test "só fala com a api local" {
  NARNIA_NOTIFY_API=http://exemplo.invalid run bash "$NOTIFY" once
  [ "$status" -eq 2 ]
  [[ "$output" == *"só a api local"* ]]
}

@test "start.sh: notify_start sobe um vigia só (de novo não duplica) e notify_stop para; NARNIA_NOTIFY=0 não sobe" {
  source "$BATS_TEST_DIRNAME/../../start.sh"
  NARNIA_NOTIFY=0 notify_start "$NARNIA_NOTIFY_API" tk "$NARNIA_NOTIFY_WEB" "$TMP/off"
  [ ! -f "$TMP/off/notify.pid" ]
  NARNIA_NOTIFY=1 notify_start "$NARNIA_NOTIFY_API" tk "$NARNIA_NOTIFY_WEB" "$TMP/state"
  pid=$(cat "$TMP/state/notify.pid")
  kill -0 "$pid"
  NARNIA_NOTIFY=1 notify_start "$NARNIA_NOTIFY_API" tk "$NARNIA_NOTIFY_WEB" "$TMP/state"
  [ "$(cat "$TMP/state/notify.pid")" = "$pid" ]
  # o laço já fez a primeira volta: cursor gravado
  for _ in $(seq 1 30); do [ -f "$TMP/state/cursor" ] && break; sleep 0.1; done
  [ -f "$TMP/state/cursor" ]
  notify_stop "$TMP/state"
  [ ! -f "$TMP/state/notify.pid" ]
  ! kill -0 "$pid" 2>/dev/null
}

@test "a instância do Claude desliga o vigia" {
  grep -qx "NARNIA_NOTIFY=0" "$BATS_TEST_DIRNAME/../../.env.claude"
}

@test "aviso sem corpo: o link não vira corpo" {
  source "$BATS_TEST_DIRNAME/../../start.sh" 2>/dev/null || true
  kill "$API_PID" 2>/dev/null || true
  node -e "
    require('http').createServer((q, r) => r.end('2026-11-12T12:09:00.000Z\\nNova tarefa: Teste\\t\\t/tarefas?id=t2\\tfalse\\n')).listen($PORT, '127.0.0.1');
  " &
  API_PID=$!
  for _ in $(seq 1 30); do curl -fs -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done
  mkdir -p "$TMP/state" && printf '2026-11-12T12:00:00.000Z' > "$TMP/state/cursor"
  run bash "$NOTIFY" once
  [ "$status" -eq 0 ]
  grep -q -- "--urgency=normal Nova tarefa: Teste http://127.0.0.1:5173/tarefas?id=t2" "$NOTIFY_LOG"
}
