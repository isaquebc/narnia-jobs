# narnia-jobs · vigia de avisos no Windows (F15-3, plans/plan-v0/tasks/F15-tarefas-e-avisos.md §2.2). Pergunta à api
# local pelos avisos novos (tarefa nova, prazo perto, prazo vencido, entrevista) e mostra a notificação do Windows
# (toast); clicar abre a tarefa no navegador. Subido e parado pelo .\start.ps1, com o Windows PowerShell (powershell.exe),
# que carrega as notificações do Windows sem instalar nada.
#
# Uso: narnia-notify.ps1 run|once
# Ambiente: NARNIA_NOTIFY_API (ex.: http://127.0.0.1:3100), NARNIA_NOTIFY_TOKEN, NARNIA_NOTIFY_WEB (endereço da
# interface), NARNIA_NOTIFY_STATE (pasta do cursor), NARNIA_NOTIFY_INTERVAL (segundos, padrão 20). Nos testes,
# NARNIA_NOTIFY_FAKE (arquivo) recebe uma linha por aviso em vez do toast.
param([string] $Mode = "run")

$ErrorActionPreference = "Stop"
$api = $env:NARNIA_NOTIFY_API
$token = $env:NARNIA_NOTIFY_TOKEN
$web = if ($env:NARNIA_NOTIFY_WEB) { $env:NARNIA_NOTIFY_WEB } else { $api }
$state = $env:NARNIA_NOTIFY_STATE
$interval = if ($env:NARNIA_NOTIFY_INTERVAL) { [int] $env:NARNIA_NOTIFY_INTERVAL } else { 20 }
if (-not $api -or -not $token -or -not $state) { [Console]::Error.WriteLine("narnia-notify: faltam NARNIA_NOTIFY_API, _TOKEN ou _STATE"); exit 2 }
# só a api local: o vigia nunca fala com outro endereço
if ($api -notmatch '^http://(127\.0\.0\.1|localhost):\d+$') { [Console]::Error.WriteLine("narnia-notify: só a api local (127.0.0.1); recebi $api"); exit 2 }
$cursorFile = Join-Path $state "cursor"
New-Item -ItemType Directory -Force -Path $state | Out-Null

function Show-Notice([string] $Title, [string] $Body, [string] $Url, [bool] $Urgent) {
  if ($env:NARNIA_NOTIFY_FAKE) {
    Add-Content -Path $env:NARNIA_NOTIFY_FAKE -Value "$Title|$Body|$Url|$Urgent"
    return
  }
  if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") { return }
  $esc = { param($s) [System.Security.SecurityElement]::Escape([string] $s) }
  $scenario = if ($Urgent) { ' scenario="reminder"' } else { "" }
  $xml = @"
<toast activationType="protocol" launch="$(& $esc $Url)"$scenario>
  <visual><binding template="ToastGeneric"><text>$(& $esc $Title)</text><text>$(& $esc $Body)</text></binding></visual>
  <actions><action content="Abrir" activationType="protocol" arguments="$(& $esc $Url)"/></actions>
</toast>
"@
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
  $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
  $doc.LoadXml($xml)
  # o id do aplicativo do próprio Windows PowerShell: aparece sem registrar um aplicativo novo
  $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show(
    [Windows.UI.Notifications.ToastNotification]::new($doc))
}

# uma volta: a api responde em texto (1ª linha o cursor; depois título, corpo, link e urgente separados por tabulação).
# Texto e não JSON: o ConvertFrom-Json do PowerShell 7 transforma o cursor em data e perde o formato.
function Invoke-Poll {
  $url = "$api/api/notifications/native?format=text"
  if (Test-Path $cursorFile) { $url += "&after=" + [uri]::EscapeDataString((Get-Content -Raw $cursorFile).Trim()) }
  $r = Invoke-WebRequest -UseBasicParsing -Uri $url -Headers @{ authorization = "Bearer $token" } -TimeoutSec 10
  $text = if ($r.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($r.Content) } else { [string] $r.Content }
  $lines = @($text -split "`n" | ForEach-Object { $_.TrimEnd("`r") })
  if ($lines.Count -and $lines[0]) { Set-Content -Path $cursorFile -Value $lines[0] -NoNewline }
  foreach ($line in ($lines | Select-Object -Skip 1)) {
    if (-not $line) { continue }
    $f = $line -split "`t"
    Show-Notice $f[0] $f[1] ($web.TrimEnd("/") + $f[2]) ($f[3] -eq "true")
  }
}

switch ($Mode) {
  "once" { Invoke-Poll }
  "run" { while ($true) { try { Invoke-Poll } catch { } ; Start-Sleep -Seconds $interval } }
  default { Write-Error "uso: narnia-notify.ps1 run|once"; exit 2 }
}
