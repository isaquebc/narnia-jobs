# narnia-jobs · lançador para Windows (PowerShell 5.1+ / 7+). Só depende de Docker Desktop (Compose v2).
# Produção:        up | down [--purge] | login | doctor | logs | status
# Desenvolvimento: dev | test | lint | typecheck | build | shell | cli | test:sh | e2e | install
[CmdletBinding()]
param(
  [Parameter(Position = 0)] [string] $Command = "help",
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)] [string[]] $Rest
)
$ErrorActionPreference = "Stop"
# Instâncias: a do dono (padrão) e a do Claude (NARNIA_INSTANCE=claude, valores em .env.claude). Os valores do arquivo
# sempre vencem o ambiente (isolamento dos dados do dono); a única exceção é NARNIA_PROVIDER.
switch ($env:NARNIA_INSTANCE) {
  { $_ -in $null, "", "owner" } { break }
  "claude" {
    foreach ($line in Get-Content (Join-Path $PSScriptRoot ".env.claude")) {
      if ($line -match '^\s*#' -or $line -notmatch '^([A-Z_]+)=(.*)$') { continue }
      if ($Matches[1] -eq "NARNIA_PROVIDER" -and $env:NARNIA_PROVIDER) { continue }
      Set-Item -Path "env:$($Matches[1])" -Value $Matches[2]
    }
  }
  default { Write-Error "erro: NARNIA_INSTANCE desconhecida: $($env:NARNIA_INSTANCE) (use vazio ou 'claude')"; exit 1 }
}
# Código da instância do dono (C7/CM-4): com `.owner-src` (worktree criada e atualizada por `promote`), a instância
# padrão monta esse código em vez da raiz; dados, backups e .env continuam na raiz. A instância claude nunca usa.
function Get-OwnerSrcDir { if ($env:NARNIA_OWNER_SRC_DIR) { $env:NARNIA_OWNER_SRC_DIR } else { "./.owner-src" } }
if ($env:NARNIA_INSTANCE -in $null, "", "owner" -and -not $env:NARNIA_SRC_DIR -and (Test-Path (Get-OwnerSrcDir))) {
  $env:NARNIA_SRC_DIR = Get-OwnerSrcDir
}
$script:PortStart  = if ($env:NARNIA_PORT_START) { [int]$env:NARNIA_PORT_START } else { 3100 }
$script:PortEnd    = if ($env:NARNIA_PORT_END)   { [int]$env:NARNIA_PORT_END }   else { 3199 }
$script:EnvFile    = if ($env:NARNIA_ENV_FILE)   { $env:NARNIA_ENV_FILE }        else { ".env" }
$script:DevCompose  = @("compose", "-f", "docker-compose.dev.yml")
$script:ProdCompose = @("compose", "-f", "docker-compose.yml")
if ($env:NARNIA_DEV_PROJECT_NAME)  { $script:DevCompose  = @("compose", "-p", $env:NARNIA_DEV_PROJECT_NAME, "-f", "docker-compose.dev.yml") }
if ($env:NARNIA_PROD_PROJECT_NAME) { $script:ProdCompose = @("compose", "-p", $env:NARNIA_PROD_PROJECT_NAME, "-f", "docker-compose.yml") }

function Fail([string] $Message) { Write-Error "erro: $Message"; exit 1 }
function Info([string] $Message) { Write-Host "» $Message" }

# --- funções puras (testes Pester em scripts/test/start.Tests.ps1) -----------------------------

function Test-PortInUse([int] $Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect("127.0.0.1", $Port); return $true } catch { return $false } finally { $client.Dispose() }
}

function Find-FreePort([int] $Start = $script:PortStart, [int] $End = $script:PortEnd) {
  for ($p = $Start; $p -le $End; $p++) { if (-not (Test-PortInUse $p)) { return $p } }
  return $null
}

function Write-Env([string] $File, [string] $Key, [string] $Value) {
  $lines = @()
  if (Test-Path $File) { $lines = @(Get-Content $File | Where-Object { $_ -notmatch "^$([regex]::Escape($Key))=" }) }
  $lines += "$Key=$Value"
  Set-Content -Path $File -Value $lines -Encoding UTF8
}

function Get-EnvValue([string] $File, [string] $Key) {
  if (-not (Test-Path $File)) { return "" }
  $match = Get-Content $File | Where-Object { $_ -match "^$([regex]::Escape($Key))=(.*)$" } | Select-Object -Last 1
  if ($match -and $match -match "^$([regex]::Escape($Key))=(.*)$") { return $Matches[1] }
  return ""
}

function Test-EnvHasValue([string] $File, [string] $Key) {
  return -not [string]::IsNullOrEmpty((Get-EnvValue $File $Key))
}

# Reutiliza NARNIA_PORT salva se estiver livre e no intervalo; senão a primeira porta livre.
function Choose-Port([string] $File, [int] $Start = $script:PortStart, [int] $End = $script:PortEnd) {
  $saved = Get-EnvValue $File "NARNIA_PORT"
  if ($saved -match '^\d+$') {
    $n = [int]$saved
    if ($n -ge $Start -and $n -le $End -and -not (Test-PortInUse $n)) { return $n }
  }
  return Find-FreePort $Start $End
}

function Get-AppUrl([int] $Port, [string] $Token) { return "http://127.0.0.1:$Port/?token=$Token" }

# --- backups e restauração (F03-fix L1, incidente de 2026-10-10) ------------------------------------------------------
function Get-DevDataHostDir { $d = if ($env:NARNIA_DEV_DATA_DIR) { $env:NARNIA_DEV_DATA_DIR } else { "/app/data" }; return "./" + ($d -replace '^/app/', '') }
function Get-DevBackupHostDir { $d = if ($env:NARNIA_DEV_BACKUP_DIR) { $env:NARNIA_DEV_BACKUP_DIR } else { "/app/backups" }; return "./" + ($d -replace '^/app/', '') }
function Get-ProdBackupHostDir { if ($env:NARNIA_BACKUP_HOST_DIR) { return $env:NARNIA_BACKUP_HOST_DIR } else { return "./backups" } }
function Get-DevDownArgs { return @($script:DevCompose + @("--profile", "app", "down", "--remove-orphans")) }

function Resolve-BackupFile([string] $Dir, [string] $Arg) {
  if ([string]::IsNullOrWhiteSpace($Arg)) { throw "informe o arquivo de backup (veja $Dir)" }
  if (Test-Path -PathType Leaf $Arg) { return $Arg }
  $inDir = Join-Path $Dir $Arg
  if (Test-Path -PathType Leaf $inDir) { return $inDir }
  throw "backup não encontrado: $Arg (pasta $Dir)"
}

# Guarda o banco atual (e o WAL) como narnia-before-restore-STAMP, põe o backup no lugar, apaga WAL/SHM do banco
# antigo (seriam reaplicados sobre o restaurado) e devolve os uploads que faltam.
function Restore-Files([string] $DataDir, [string] $BackupDir, [string] $File, [string] $Stamp) {
  New-Item -ItemType Directory -Force -Path $DataDir, $BackupDir | Out-Null
  $db = Join-Path $DataDir "narnia.sqlite"
  if (Test-Path $db) {
    Copy-Item $db (Join-Path $BackupDir "narnia-before-restore-$Stamp.sqlite")
    if (Test-Path "$db-wal") { Copy-Item "$db-wal" (Join-Path $BackupDir "narnia-before-restore-$Stamp.sqlite-wal") }
  }
  Copy-Item $File "$db.restoring" -Force
  Move-Item "$db.restoring" $db -Force
  Remove-Item "$db-wal", "$db-shm" -Force -ErrorAction SilentlyContinue
  $up = Join-Path $BackupDir "uploads"
  if (Test-Path $up) {
    $dst = Join-Path $DataDir "uploads"; New-Item -ItemType Directory -Force -Path $dst | Out-Null
    foreach ($f in Get-ChildItem -File $up) { if (-not (Test-Path (Join-Path $dst $f.Name))) { Copy-Item $f.FullName $dst } }
  }
}

# Leva a instância do dono (.owner-src) para um commit verde (padrão HEAD); só o dono roda
function Invoke-Promote([string] $Commit = "HEAD") {
  if ($env:NARNIA_INSTANCE -eq "claude" -or $env:NARNIA_DEV_PROJECT_NAME -eq "narnia-claude") {
    throw "promote atualiza a instância do dono: quem roda é o dono (.\start.ps1 promote), não a instância claude."
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "git não encontrado." }
  $dir = Get-OwnerSrcDir
  if (git status --porcelain --untracked-files=no) { Fail "há alterações não commitadas na raiz; commite (ou descarte) antes de promover." }
  $sha = git rev-parse --verify --quiet "$Commit^{commit}"
  if (-not $sha) { Fail "commit inválido: $Commit" }
  if (Test-Path $dir) { git -C $dir checkout -q --detach $sha; if ($LASTEXITCODE -ne 0) { Fail "não consegui mover $dir." } }
  else { git worktree add -q --detach $dir $sha *> $null; if ($LASTEXITCODE -ne 0) { Fail "não consegui criar $dir." } }
  Info "instância do dono agora no commit $($sha.Substring(0,7)) ($dir)."
  Info "o hot reload aplica o código; se mudaram dependências, composes ou a imagem: make dev-down; make dev"
}

function Invoke-Restore {
  Assert-Docker
  $mode = $null; $arg = $null
  foreach ($a in $Rest) { switch ($a) { "--dev" { $mode = "dev" } "--prod" { $mode = "prod" } default { $arg = $a } } }
  if (-not $mode) {
    $devApi = & docker @script:DevCompose ps -q api 2>$null
    $mode = if ($devApi) { "dev" } elseif (Test-StackRunning) { "prod" } else { "dev" }
  }
  if ($mode -eq "dev") { $compose = $script:DevCompose + @("--profile", "app"); $data = Get-DevDataHostDir; $bdir = Get-DevBackupHostDir }
  else { $compose = $script:ProdCompose; $data = if ($env:NARNIA_DATA_DIR) { $env:NARNIA_DATA_DIR } else { "./data" }; $bdir = Get-ProdBackupHostDir }
  try { $file = Resolve-BackupFile $bdir $arg } catch { Fail $_.Exception.Message }
  $running = & docker @compose ps -q api 2>$null
  Info "restaurando $(Split-Path -Leaf $file) em $data (modo $mode); o banco atual fica guardado em $bdir"
  if ($running) { & docker @compose stop api worker *> $null }
  Restore-Files $data $bdir $file ((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ss"))
  if ($running) { & docker @compose start api worker *> $null }
  Info "pronto. Recarregue a página."
}

# --- F04 · modo B: plugin no Claude Code do host (mesmo desenho do start.sh) ----------------------------------------
function Get-McpServerName { if ($env:NARNIA_MCP_NAME) { $env:NARNIA_MCP_NAME } else { "narnia-jobs" } }
function Get-PluginMarketplaceName { if ($env:NARNIA_PLUGIN_MARKETPLACE) { $env:NARNIA_PLUGIN_MARKETPLACE } else { "narnia-jobs-local" } }
function Get-PluginStageDir { if ($env:NARNIA_PLUGIN_STAGE) { $env:NARNIA_PLUGIN_STAGE } else { "./.plugin-build" } }
function Get-PluginEndpoint([string] $Mode = "dev") {
  if ($Mode -eq "prod") {
    $token = ((& docker @script:ProdCompose exec -T api cat /data/.token 2>$null) -join "").Trim()
    return "http://127.0.0.1:$(Get-EnvValue $script:EnvFile 'NARNIA_PORT')|$token"
  }
  $port = if ($env:NARNIA_DEV_API_PORT) { $env:NARNIA_DEV_API_PORT } else { "3100" }
  $token = if ($env:NARNIA_TOKEN) { $env:NARNIA_TOKEN } else { "dev-token" }
  return "http://127.0.0.1:$port|$token"
}
function Invoke-ClaudeCli { param([string[]] $Arguments)
  if ($global:NarniaClaudeCliOverride) { return (& $global:NarniaClaudeCliOverride $Arguments) }   # só nos testes
  $bin = if ($env:NARNIA_CLAUDE_BIN) { $env:NARNIA_CLAUDE_BIN } else { "claude" }
  & $bin @Arguments 2>$null
}
# Agente `recrutador` renderizado pela api (persona e domínios atuais, tools do servidor $Name, cartão via
# `profile_get_card`): o template do repositório tem placeholders e não pode ir cru (auditoria C)
function Get-PluginAgent([string] $Url, [string] $Token, [string] $Name) {
  if ($global:NarniaPluginAgentOverride) { return (& $global:NarniaPluginAgentOverride $Url $Token $Name) }   # só nos testes
  try {
    return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Headers @{ Authorization = "Bearer $Token" } `
      -Uri "$Url/api/profiles/active/persona-card?format=agent&server=$Name").Content
  } catch { return $null }
}
function Build-PluginStage([string] $Src, [string] $Stage, [string] $Url, [string] $Token, [string] $Mkt, [string] $Name) {
  $agent = Get-PluginAgent $Url $Token $Name
  if (-not $agent -or -not $agent.StartsWith("---")) {
    Fail "não consegui gerar o agente do recrutador pela api ($Url): suba a instância e conclua o primeiro uso antes de instalar o plugin."
  }
  if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
  New-Item -ItemType Directory -Force -Path (Join-Path $Stage ".claude-plugin") | Out-Null
  Copy-Item -Recurse -Force $Src (Join-Path $Stage "plugin")
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Stage "plugin/.mcp.json"), (Join-Path $Stage "plugin/.mcp.json.template"), (Join-Path $Stage "plugin/.narnia-env")
  # prompts/ são notas que a api preenche (modo A e a rota do agente); o Claude Code não as usa e elas têm `{{…}}`
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $Stage "plugin/prompts")
  Set-Content -NoNewline -Path (Join-Path $Stage "plugin/agents/recrutador.md") -Value $agent
  Set-Content -Path (Join-Path $Stage "plugin/.narnia-env") -Value @("NARNIA_API_URL=$Url", "NARNIA_TOKEN=$Token")
  # cabeçalho do MCP lido pelo headersHelper: o token não vai na linha de comando nem na config do Claude Code
  Set-Content -NoNewline -Path (Join-Path $Stage "mcp-headers.json") -Value "{`"Authorization`":`"Bearer $Token`"}"
  $json = @"
{
  "name": "$Mkt",
  "owner": { "name": "narnia-jobs" },
  "description": "Instalação local do recrutador do narnia-jobs (gerada pelo install-plugin)",
  "plugins": [
    { "name": "narnia-jobs", "source": "./plugin", "description": "Recrutador sênior do narnia-jobs (instalação local)" }
  ]
}
"@
  Set-Content -Path (Join-Path $Stage ".claude-plugin/marketplace.json") -Value $json
}
function Install-PluginWith([string] $Stage, [string] $Name, [string] $Url, [string] $Mkt) {
  $abs = (Resolve-Path $Stage).Path
  $headers = Join-Path $abs "mcp-headers.json"
  # o Claude Code no Windows roda comandos pelo Git Bash, que aceita o caminho do Windows entre aspas simples
  $config = [ordered]@{ type = "http"; url = "$Url/mcp"; headersHelper = "cat '$headers'" } | ConvertTo-Json -Compress
  Invoke-ClaudeCli @("mcp", "remove", "-s", "user", $Name) | Out-Null
  Invoke-ClaudeCli @("mcp", "add-json", "-s", "user", $Name, $config) | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "não consegui registrar o servidor MCP $Name no Claude Code." }
  Invoke-ClaudeCli @("plugin", "marketplace", "add", $abs, "--scope", "user") | Out-Null
  if ($LASTEXITCODE -ne 0) { Invoke-ClaudeCli @("plugin", "marketplace", "update", $Mkt) | Out-Null }
  Invoke-ClaudeCli @("plugin", "uninstall", "narnia-jobs@$Mkt") | Out-Null
  Invoke-ClaudeCli @("plugin", "install", "narnia-jobs@$Mkt", "--scope", "user") | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "não consegui instalar o plugin narnia-jobs@$Mkt no Claude Code." }
  Info "Claude Code: servidor MCP '$Name' -> $Url/mcp e plugin narnia-jobs@$Mkt instalados. Reinicie o Claude Code."
  Info "Mantenha ${abs}: o Claude Code lê o token de lá. Mudou a persona? Rode install-plugin de novo."
}
function Test-PluginInstall([string] $Name, [string] $Url, [string] $Mkt) {
  $out = (Invoke-ClaudeCli @("mcp", "get", $Name)) -join "`n"
  if ($LASTEXITCODE -ne 0 -or -not $out) { "MCP ${Name}: não registrado; rode .\start.ps1 install-plugin" }
  elseif ($out -match [regex]::Escape("$Url/mcp")) { "MCP ${Name}: ok ($Url/mcp)" }
  else { "MCP ${Name}: porta mudou; rode .\start.ps1 install-plugin" }
  $list = (Invoke-ClaudeCli @("plugin", "list", "--json")) -join "`n"
  if ($list -match [regex]::Escape("narnia-jobs@$Mkt")) { "plugin narnia-jobs@${Mkt}: instalado" }
  else { "plugin narnia-jobs@${Mkt}: não instalado; rode .\start.ps1 install-plugin" }
}
function Invoke-InstallPlugin {
  $mode = if ($Rest -contains "--prod") { "prod" } else { "dev" }
  $ep = Get-PluginEndpoint $mode; $url, $token = $ep -split '\|', 2
  if (-not $token) { Fail "instância fora do ar: suba com make dev ou .\start.ps1 up antes de instalar o plugin." }
  Build-PluginStage "./plugin" (Get-PluginStageDir) $url $token (Get-PluginMarketplaceName) (Get-McpServerName)
  Install-PluginWith (Get-PluginStageDir) (Get-McpServerName) $url (Get-PluginMarketplaceName)
}

# Token do `gh` logado no computador (F03-1); $null sem gh ou sem login. Entregue ao container pela entrada padrão.
function Get-HostGhToken {
  $bin = if ($env:NARNIA_GH_BIN) { $env:NARNIA_GH_BIN } else { "gh" }
  if (-not (Get-Command $bin -ErrorAction SilentlyContinue)) { return $null }
  try { $token = (& $bin auth token 2>$null) -join "" } catch { return $null }
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) { return $null }
  return $token.Trim()
}

function Send-HostGhToken([string[]] $Compose, [string] $Service) {
  # volumes criados por imagens antigas nascem com dono root: o app (usuário node) não grava o token nem o login próprio
  & docker @Compose run --rm --no-deps -T --user root --entrypoint sh $Service -c 'mkdir -p /home/node/.config/gh && chown node:node /home/node/.config/gh' *> $null
  $token = Get-HostGhToken
  if ($token) {
    $token | & docker @Compose run --rm --no-deps -T --entrypoint sh $Service -c 'umask 077; mkdir -p "$HOME/.config/gh"; cat > "$HOME/.config/gh/host-token"' *> $null
    if ($LASTEXITCODE -eq 0) { Info "GitHub: usando o login do gh deste computador." }
  } else {
    & docker @Compose run --rm --no-deps -T --entrypoint sh $Service -c 'rm -f "$HOME/.config/gh/host-token"' *> $null
  }
}

# --- infraestrutura ----------------------------------------------------------------------------

# imagem de dev sempre atualizada (com cache leva segundos): sem isso a instância sobe com a imagem antiga (ex.: sem gh)
function Invoke-DevBuild { & docker @script:DevCompose --profile app build *> $null; if ($LASTEXITCODE -ne 0) { Fail "não consegui construir as imagens de dev." } }

function Assert-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "Docker não encontrado. Instale o Docker Desktop." }
  docker info *> $null; if ($LASTEXITCODE -ne 0) { Fail "Docker não está rodando. Inicie o Docker Desktop e tente de novo." }
  docker compose version *> $null; if ($LASTEXITCODE -ne 0) { Fail "Docker Compose v2 não encontrado (comando 'docker compose')." }
}

function Invoke-Dev([string[]] $Args) { & docker @script:DevCompose run --rm dev @Args; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
function Invoke-Prod([string[]] $Args) { & docker @script:ProdCompose @Args; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }

# --- e2e (M7): Playwright em container contra a stack de produção com provider mock -------------------
$script:E2eProject = if ($env:NARNIA_E2E_PROJECT) { $env:NARNIA_E2E_PROJECT } else { "narnia-e2e" }
$script:E2eCompose = @("compose", "-p", $script:E2eProject, "-f", "docker-compose.yml", "-f", "docker-compose.e2e.yml")

function Invoke-E2e([string[]] $Args) { & docker @script:E2eCompose @Args; return $LASTEXITCODE }
function Invoke-E2eUp { return (Invoke-E2e @("up", "-d", "--wait", "web", "api", "worker", "redis")) }
function Invoke-Play([string[]] $Args) {
  return (Invoke-E2e (@("--profile", "e2e", "run", "--rm", "--no-deps", "playwright", "./node_modules/.bin/playwright", "test") + $Args))
}

function Invoke-E2eSuite {
  Assert-Docker; Ensure-Installed
  $devProject = (& docker @script:DevCompose config 2>$null | Where-Object { $_ -match '^name: ' } | Select-Object -First 1) -replace '^name: ', ''
  if (-not $devProject) { Fail "não consegui descobrir o projeto do compose de dev." }
  $env:NARNIA_DEV_PROJECT = $devProject
  # no Docker Desktop (Windows/macOS) os bind mounts já pertencem ao usuário do container
  $uiOnly = $Rest -contains "--ui-only"
  $args = @($Rest | Where-Object { $_ -ne "--ui-only" })
  New-Item -ItemType Directory -Force -Path "./.e2e-data" *> $null
  Info "e2e: construindo imagens e subindo a stack (projeto $($script:E2eProject), provider mock)…"
  if ((Invoke-E2e @("build")) -ne 0) { Fail "build das imagens falhou." }
  if ((Invoke-E2eUp) -ne 0) { Fail "a stack e2e não subiu." }
  $rc = Invoke-Play (@("--grep-invert", "@ops") + $args)
  if ($rc -eq 0 -and -not $uiOnly) {
    $rc = Invoke-Play @("--grep", "E2E-06.*parte 1")
    if ($rc -eq 0) { Invoke-E2e @("down") *> $null; Invoke-E2eUp *> $null; $rc = Invoke-Play @("--grep", "E2E-06.*parte 2") }
  }
  if ($rc -eq 0 -and -not $uiOnly) {
    $rc = Invoke-Play @("--grep", "E2E-12.*parte 1")
    if ($rc -eq 0) { Invoke-E2e @("kill", "worker") *> $null; Invoke-E2e @("up", "-d", "--wait", "worker") *> $null; $rc = Invoke-Play @("--grep", "E2E-12.*parte 2") }
  }
  Invoke-E2e @("down", "-v", "--remove-orphans") *> $null
  # E2E-13 (porta ocupada no lançador) roda só pelo start.sh (CI Linux); as funções de porta do start.ps1 têm testes Pester.
  if ($rc -eq 0) { Info "e2e: tudo verde." } else { Info "e2e: falhou (código $rc); relatório em apps/e2e/report/index.html"; exit $rc }
}

function Ensure-Installed {
  & docker @script:DevCompose run --rm dev sh -c 'test -f node_modules/.modules.yaml && pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 || pnpm install --frozen-lockfile' *> $null
}

function Test-StackRunning { $id = & docker @script:ProdCompose ps -q web 2>$null; return -not [string]::IsNullOrWhiteSpace("$id") }

function Wait-Healthy([string] $Service, [int] $Seconds = 120) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    $cid = (& docker @script:ProdCompose ps -q $Service 2>$null | Select-Object -First 1)
    if ($cid) {
      $status = & docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $cid 2>$null
      if ($status -eq "healthy") { return $true }
      if ($status -in "exited", "dead") { return $false }
    }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Invoke-Up {
  Assert-Docker
  $dataDir = if ($env:NARNIA_DATA_DIR) { $env:NARNIA_DATA_DIR } else { "./data" }
  New-Item -ItemType Directory -Force -Path $dataDir, (Get-ProdBackupHostDir) *> $null
  if (Test-StackRunning) {
    $port = Get-EnvValue $script:EnvFile "NARNIA_PORT"
    Info "stack já no ar na porta $port; aplicando alterações"
  } else {
    $envDir = Split-Path -Parent $script:EnvFile; if ($envDir) { New-Item -ItemType Directory -Force -Path $envDir *> $null }
    $port = Choose-Port $script:EnvFile
    if (-not $port) { Fail "nenhuma porta livre entre $($script:PortStart) e $($script:PortEnd)." }
    Write-Env $script:EnvFile "NARNIA_PORT" $port
    Info "porta escolhida: $port (gravada em $($script:EnvFile))"
  }
  Invoke-Prod @("build")
  Send-HostGhToken $script:ProdCompose "api"
  Invoke-Prod (@("up", "-d") + $Rest)
  Info "aguardando a api ficar saudável…"
  if (-not (Wait-Healthy "api" 120)) { & docker @script:ProdCompose logs --tail=40 api; Fail "a api não ficou saudável em 120 s. Veja '.\start.ps1 logs api'." }
  $token = (& docker @script:ProdCompose exec -T api cat /data/.token) -join ""
  if ([string]::IsNullOrWhiteSpace($token)) { Fail "não consegui ler o token de boot em /data/.token." }
  Write-Host ""; Write-Host "  narnia-jobs está no ar:"; Write-Host ""; Write-Host "    $(Get-AppUrl $port $token.Trim())"; Write-Host ""
  if (Test-EnvHasValue $script:EnvFile "CLAUDE_CODE_OAUTH_TOKEN") { Info "login: usando CLAUDE_CODE_OAUTH_TOKEN do $($script:EnvFile)." }
  else { Info "login da assinatura (uma vez): .\start.ps1 login   · diagnóstico: .\start.ps1 doctor" }
  Info "dados em $dataDir · parar: .\start.ps1 down"
}

function Invoke-Down {
  Assert-Docker
  if ($Rest -contains "--purge") {
    Write-Host "Isso remove também os volumes: o LOGIN da assinatura (claude-auth) e a fila (redis-data)."
    $answer = Read-Host "A pasta de dados NÃO é apagada. Continuar? [s/N]"
    if ($answer -notmatch '^[sSyY]$') { Fail "cancelado." }
    Invoke-Prod @("down", "-v", "--remove-orphans")
  } else {
    Invoke-Prod (@("down", "--remove-orphans") + $Rest)
  }
}

function Invoke-Login {
  Assert-Docker
  if (Test-EnvHasValue $script:EnvFile "CLAUDE_CODE_OAUTH_TOKEN") { Info "atenção: CLAUDE_CODE_OAUTH_TOKEN está definido em $($script:EnvFile) e prevalece sobre o login no volume." }
  Write-Host "Login da assinatura do Claude dentro do container (credencial no volume claude-auth)."
  Write-Host "O CLI vai imprimir uma URL: abra no navegador, autorize e cole o código de volta aqui."
  Invoke-Prod @("run", "--rm", "--no-deps", "api", "narnia-jobs", "login")
}

function Show-Usage {
@"
narnia-jobs · .\start.ps1 <comando>

Uso (produção, só Docker no host):
  up            escolhe uma porta livre (3100–3199), sobe web + api + worker + redis e imprime a URL
  down          para os serviços (dados e login preservados)
  down --purge  para e remove os volumes (apaga o LOGIN da assinatura; a pasta de dados fica)
  restore ARQ   restaura um backup de ./backups (para api/worker, guarda o banco atual, troca, sobe)
  login         login da assinatura dentro do container (uma vez)
  doctor        diagnóstico: login, Redis, pasta de dados, worker
  logs [svc]    acompanha os logs (api | worker | web | redis)
  status        estado dos serviços

Desenvolvimento (tudo em containers):
  dev-down      para a stack de dev desta instância
  dev           sobe web (http://127.0.0.1:5173), api, worker e redis com hot reload
  test [args]   roda os testes unitários (Vitest) de todos os pacotes
  lint          Biome (formatação + lint)
  typecheck     tsc em todos os pacotes
  build         build de todos os pacotes
  shell         abre um shell no container de desenvolvimento
  cli <cmd>     roda a CLI narnia-jobs (doctor | login | install-plugin) no container de dev
  test:sh       testa start.sh (bats) e start.ps1 (Pester) em containers
  e2e [args]    testes de ponta a ponta (Playwright em container, provider mock); --ui-only pula down/up e worker
  install       instala dependências no volume node_modules
"@
}

if (-not $env:NARNIA_PS_NO_MAIN) {
  switch ($Command) {
    "up"        { Invoke-Up }
    "down"      { Invoke-Down }
    "login"     { Invoke-Login }
    "doctor"    {
      Assert-Docker
      $devApi = & docker @script:DevCompose ps -q api 2>$null
      if ($devApi) { & docker @script:DevCompose exec -T api pnpm --filter @narnia-jobs/api exec tsx src/cli.ts doctor }
      elseif (Test-StackRunning) { Invoke-Prod @("exec", "-T", "api", "narnia-jobs", "doctor") }
      else { Invoke-Prod @("run", "--rm", "api", "narnia-jobs", "doctor") }
      if (Get-Command ($(if ($env:NARNIA_CLAUDE_BIN) { $env:NARNIA_CLAUDE_BIN } else { "claude" })) -ErrorAction SilentlyContinue) {
        $ep = Get-PluginEndpoint "dev"; Test-PluginInstall (Get-McpServerName) ($ep -split '\|', 2)[0] (Get-PluginMarketplaceName)
      }
    }
    "install-plugin" { Invoke-InstallPlugin }
    "restore"   { Invoke-Restore }
    "promote"   { Invoke-Promote @Rest }
    "dev-down"  { Assert-Docker; $a = Get-DevDownArgs; & docker @a }
    "logs"      { Assert-Docker; Invoke-Prod (@("logs", "-f", "--tail=100") + $Rest) }
    "status"    { Assert-Docker; Invoke-Prod @("ps") }
    "dev"       {
      Assert-Docker
      Invoke-DevBuild
      Ensure-Installed
      $devPort = if ($env:NARNIA_DEV_PORT) { $env:NARNIA_DEV_PORT } else { "5173" }
      $devToken = if ($env:NARNIA_TOKEN) { $env:NARNIA_TOKEN } else { "dev-token" }
      New-Item -ItemType Directory -Force -Path (Get-DevDataHostDir), (Get-DevBackupHostDir) *> $null
      Send-HostGhToken $script:DevCompose "dev"
      Write-Host ""; Write-Host "  modo dev (hot reload):  $(Get-AppUrl $devPort $devToken)"
      if (Test-EnvHasValue $script:EnvFile "CLAUDE_CODE_OAUTH_TOKEN") { Info "login: usando CLAUDE_CODE_OAUTH_TOKEN do $($script:EnvFile)." }
      else { Info "login da assinatura (uma vez, vale para dev e produção): .\start.ps1 login   · mock: `$env:NARNIA_PROVIDER='mock'" }
      & docker @script:DevCompose --profile app up @Rest
    }
    "test"      { Assert-Docker; Ensure-Installed; Invoke-Dev (@("pnpm", "test") + $Rest) }
    "lint"      { Assert-Docker; Ensure-Installed; Invoke-Dev (@("pnpm", "lint") + $Rest) }
    "typecheck" { Assert-Docker; Ensure-Installed; Invoke-Dev (@("pnpm", "typecheck") + $Rest) }
    "build"     { Assert-Docker; Ensure-Installed; Invoke-Dev (@("pnpm", "build") + $Rest) }
    "install"   { Assert-Docker; Invoke-Dev (@("pnpm", "install") + $Rest) }
    "shell"     { Assert-Docker; Ensure-Installed; Invoke-Dev @("bash") }
    "cli"       { Assert-Docker; Ensure-Installed; Invoke-Dev (@("pnpm", "--filter", "@narnia-jobs/api", "exec", "tsx", "src/cli.ts") + $Rest) }
    "e2e"       { Invoke-E2eSuite }
    "test:sh"   {
      Assert-Docker
      Invoke-Dev @("bats", "scripts/test")
      & docker run --rm -v "${PWD}:/code:ro" -w /code -e NARNIA_PS_NO_MAIN=1 mcr.microsoft.com/powershell:7.4-ubuntu-22.04 pwsh -NoProfile -Command "Install-Module Pester -MinimumVersion 5.0 -Force -Scope CurrentUser -SkipPublisherCheck | Out-Null; Invoke-Pester -Path scripts/test -Output Detailed -ErrorAction Stop"
    }
    { $_ -in "help", "-h", "--help" } { Show-Usage }
    default     { Show-Usage; Fail "comando desconhecido: $Command" }
  }
}
