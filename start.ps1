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

# Token do `gh` logado no computador (F03-1); $null sem gh ou sem login. Entregue ao container pela entrada padrão.
function Get-HostGhToken {
  $bin = if ($env:NARNIA_GH_BIN) { $env:NARNIA_GH_BIN } else { "gh" }
  if (-not (Get-Command $bin -ErrorAction SilentlyContinue)) { return $null }
  try { $token = (& $bin auth token 2>$null) -join "" } catch { return $null }
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) { return $null }
  return $token.Trim()
}

function Send-HostGhToken([string[]] $Compose, [string] $Service) {
  $token = Get-HostGhToken
  if ($token) {
    $token | & docker @Compose run --rm --no-deps -T --entrypoint sh $Service -c 'umask 077; mkdir -p "$HOME/.config/gh"; cat > "$HOME/.config/gh/host-token"' *> $null
    if ($LASTEXITCODE -eq 0) { Info "GitHub: usando o login do gh deste computador." }
  } else {
    & docker @Compose run --rm --no-deps -T --entrypoint sh $Service -c 'rm -f "$HOME/.config/gh/host-token"' *> $null
  }
}

# --- infraestrutura ----------------------------------------------------------------------------

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
  New-Item -ItemType Directory -Force -Path $dataDir *> $null
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
  login         login da assinatura dentro do container (uma vez)
  doctor        diagnóstico: login, Redis, pasta de dados, worker
  logs [svc]    acompanha os logs (api | worker | web | redis)
  status        estado dos serviços

Desenvolvimento (tudo em containers):
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
    "doctor"    { Assert-Docker; Invoke-Prod @("run", "--rm", "api", "narnia-jobs", "doctor") }
    "logs"      { Assert-Docker; Invoke-Prod (@("logs", "-f", "--tail=100") + $Rest) }
    "status"    { Assert-Docker; Invoke-Prod @("ps") }
    "dev"       {
      Assert-Docker; Ensure-Installed
      $devPort = if ($env:NARNIA_DEV_PORT) { $env:NARNIA_DEV_PORT } else { "5173" }
      $devToken = if ($env:NARNIA_TOKEN) { $env:NARNIA_TOKEN } else { "dev-token" }
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
