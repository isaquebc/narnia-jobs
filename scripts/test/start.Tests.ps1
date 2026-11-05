# Testes Pester das funções puras de start.ps1. Rodar com: ./start.sh test:sh (ou .\start.ps1 test:sh), que usa a imagem
# mcr.microsoft.com/powershell com NARNIA_PS_NO_MAIN=1 para carregar o script sem executar o comando.
BeforeAll {
  $env:NARNIA_PS_NO_MAIN = "1"
  . "$PSScriptRoot/../../start.ps1"
  $script:Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("narnia-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $script:Tmp | Out-Null
  function Start-Occupier([int] $Port) {
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    $l.Start(); return $l
  }
}
AfterAll { Remove-Item -Recurse -Force $script:Tmp -ErrorAction SilentlyContinue }

Describe "Find-FreePort" {
  It "devolve o início do intervalo quando está livre" { Find-FreePort 3150 3159 | Should -Be 3150 }
  It "pula uma porta ocupada" {
    $l = Start-Occupier 3160
    try { Find-FreePort 3160 3169 | Should -Be 3161 } finally { $l.Stop() }
  }
  It "devolve nulo quando todo o intervalo está ocupado" {
    $l = Start-Occupier 3170
    try { Find-FreePort 3170 3170 | Should -BeNullOrEmpty } finally { $l.Stop() }
  }
}

Describe "Write-Env / Get-EnvValue / Test-EnvHasValue" {
  It "cria o arquivo e grava a chave" {
    $f = Join-Path $script:Tmp "a.env"
    Write-Env $f "NARNIA_PORT" "3101"
    (Get-Content $f) | Should -Be @("NARNIA_PORT=3101")
  }
  It "atualiza a chave preservando as outras linhas" {
    $f = Join-Path $script:Tmp "b.env"
    Set-Content $f @("OUTRA=1", "NARNIA_PORT=3100", "MAIS=2")
    Write-Env $f "NARNIA_PORT" "3105"
    Get-EnvValue $f "NARNIA_PORT" | Should -Be "3105"
    (Get-Content $f).Count | Should -Be 3
    (Get-Content $f) | Should -Contain "OUTRA=1"
    (Get-Content $f) | Should -Contain "MAIS=2"
  }
  It "não confunde chaves com o mesmo prefixo" {
    $f = Join-Path $script:Tmp "c.env"
    Set-Content $f @("NARNIA_PORT_START=3100")
    Write-Env $f "NARNIA_PORT" "3102"
    Get-EnvValue $f "NARNIA_PORT_START" | Should -Be "3100"
    Get-EnvValue $f "NARNIA_PORT" | Should -Be "3102"
  }
  It "devolve vazio para arquivo inexistente ou chave ausente" {
    Get-EnvValue (Join-Path $script:Tmp "nao-existe") "NARNIA_PORT" | Should -Be ""
  }
  It "distingue chave ausente, vazia e preenchida" {
    $f = Join-Path $script:Tmp "d.env"
    Set-Content $f @("CLAUDE_CODE_OAUTH_TOKEN=", "OUTRA=x")
    Test-EnvHasValue $f "CLAUDE_CODE_OAUTH_TOKEN" | Should -BeFalse
    Test-EnvHasValue $f "OUTRA" | Should -BeTrue
    Test-EnvHasValue $f "NADA" | Should -BeFalse
  }
}

Describe "Choose-Port" {
  It "reutiliza a porta salva quando está livre" {
    $f = Join-Path $script:Tmp "e.env"; Set-Content $f @("NARNIA_PORT=3182")
    Choose-Port $f 3180 3189 | Should -Be 3182
  }
  It "procura outra porta quando a salva está ocupada" {
    $f = Join-Path $script:Tmp "f.env"; Set-Content $f @("NARNIA_PORT=3183")
    $l = Start-Occupier 3183
    try { Choose-Port $f 3183 3189 | Should -Be 3184 } finally { $l.Stop() }
  }
  It "usa o início do intervalo sem .env" { Choose-Port (Join-Path $script:Tmp "x.env") 3190 3195 | Should -Be 3190 }
  It "ignora porta salva fora do intervalo" {
    $f = Join-Path $script:Tmp "g.env"; Set-Content $f @("NARNIA_PORT=9999")
    Choose-Port $f 3196 3198 | Should -Be 3196
  }
}

Describe "Get-AppUrl" {
  It "monta a URL de abertura" { Get-AppUrl 3101 "abc123" | Should -Be "http://127.0.0.1:3101/?token=abc123" }
}

Describe "Instâncias (NARNIA_INSTANCE)" {
  It "instância claude: projetos, portas e dados próprios; ignora NARNIA_DATA_DIR do ambiente" {
    $script = Join-Path $PSScriptRoot "../../start.ps1"
    $env:NARNIA_INSTANCE = "claude"; $env:NARNIA_DATA_DIR = "./data"
    try {
      $out = pwsh -NoProfile -Command ". '$script'; '{0}|{1}|{2}|{3}|{4}' -f (`$script:DevCompose -join ' '), (`$script:ProdCompose -join ' '), `$script:EnvFile, `$script:PortStart, `$env:NARNIA_DATA_DIR"
    } finally {
      Remove-Item env:NARNIA_INSTANCE, env:NARNIA_DATA_DIR, env:NARNIA_DEV_PROJECT_NAME, env:NARNIA_PROD_PROJECT_NAME -ErrorAction SilentlyContinue
    }
    $out | Should -Be "compose -p narnia-claude -f docker-compose.dev.yml|compose -p narnia-claude-prod -f docker-compose.yml|.claude-data/.env|3250|./.claude-data/prod"
  }
  It "instância padrão não usa -p" {
    ($script:DevCompose -join " ") | Should -Be "compose -f docker-compose.dev.yml"
  }
}

Describe "Get-HostGhToken (F03-1)" {
  It "devolve o token do gh logado e nulo sem gh" {
    $bin = Join-Path $script:Tmp "ghbin"
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    $gh = Join-Path $bin "gh"
    Set-Content -Path $gh -Value "#!/bin/sh`nprintf 'gho_tokenDoHost\n'"
    chmod +x $gh
    $env:NARNIA_GH_BIN = $gh
    try { Get-HostGhToken | Should -Be "gho_tokenDoHost" } finally { Remove-Item env:NARNIA_GH_BIN }
    $env:NARNIA_GH_BIN = (Join-Path $script:Tmp "nao-existe/gh")
    try { Get-HostGhToken | Should -BeNullOrEmpty } finally { Remove-Item env:NARNIA_GH_BIN }
  }
}

Describe "Backups e restore (F03-fix L1)" {
  It "pastas de backup do dono e dev-down sem -p na instância padrão" {
    Get-DevBackupHostDir | Should -Be "./backups"
    Get-ProdBackupHostDir | Should -Be "./backups"
    (Get-DevDownArgs) -join " " | Should -Be "compose -f docker-compose.dev.yml --profile app down --remove-orphans"
  }
  It "Resolve-BackupFile aceita nome dentro da pasta e recusa inexistente" {
    $b = Join-Path $script:Tmp "bk"; New-Item -ItemType Directory -Force -Path $b | Out-Null
    $f = Join-Path $b "narnia-boot-x.sqlite"; Set-Content -Path $f -Value ""
    Resolve-BackupFile $b "narnia-boot-x.sqlite" | Should -Be $f
    { Resolve-BackupFile $b "nao-existe.sqlite" } | Should -Throw "*não encontrado*"
  }
  It "Restore-Files guarda o atual com WAL, troca, apaga WAL/SHM velhos e devolve uploads" {
    $d = Join-Path $script:Tmp "rdata"; $b = Join-Path $script:Tmp "rbk"
    New-Item -ItemType Directory -Force -Path (Join-Path $d "uploads"), (Join-Path $b "uploads") | Out-Null
    Set-Content -NoNewline -Path (Join-Path $d "narnia.sqlite") -Value "atual"
    Set-Content -NoNewline -Path (Join-Path $d "narnia.sqlite-wal") -Value "wal"
    Set-Content -NoNewline -Path (Join-Path $d "narnia.sqlite-shm") -Value "shm"
    Set-Content -NoNewline -Path (Join-Path $b "narnia-boot-x.sqlite") -Value "backup"
    Set-Content -NoNewline -Path (Join-Path $b "uploads/aaa.pdf") -Value "cv"
    Restore-Files $d $b (Join-Path $b "narnia-boot-x.sqlite") "STAMP"
    Get-Content -Raw (Join-Path $d "narnia.sqlite") | Should -Be "backup"
    Test-Path (Join-Path $d "narnia.sqlite-wal") | Should -BeFalse
    Test-Path (Join-Path $d "narnia.sqlite-shm") | Should -BeFalse
    Get-Content -Raw (Join-Path $b "narnia-before-restore-STAMP.sqlite") | Should -Be "atual"
    Get-Content -Raw (Join-Path $b "narnia-before-restore-STAMP.sqlite-wal") | Should -Be "wal"
    Get-Content -Raw (Join-Path $d "uploads/aaa.pdf") | Should -Be "cv"
  }

  It "Restore-Files devolve os templates de CV enviados (F05) que faltam, sem sobrescrever" {
    $d = Join-Path $script:Tmp "tdata"; $b = Join-Path $script:Tmp "tbk"
    New-Item -ItemType Directory -Force -Path (Join-Path $d "templates"), (Join-Path $b "templates") | Out-Null
    Set-Content -NoNewline -Path (Join-Path $b "narnia-boot-x.sqlite") -Value "backup"
    Set-Content -NoNewline -Path (Join-Path $b "templates/t1.zip") -Value "zip1"
    Set-Content -NoNewline -Path (Join-Path $b "templates/t2.zip") -Value "zip2-backup"
    Set-Content -NoNewline -Path (Join-Path $d "templates/t2.zip") -Value "zip2-atual"
    Restore-Files $d $b (Join-Path $b "narnia-boot-x.sqlite") "STAMP"
    Get-Content -Raw (Join-Path $d "templates/t1.zip") | Should -Be "zip1"
    Get-Content -Raw (Join-Path $d "templates/t2.zip") | Should -Be "zip2-atual"
  }

  It "Restore-Files devolve os anexos das candidaturas (F07) que faltam, sem sobrescrever" {
    $d = Join-Path $script:Tmp "jdata"; $b = Join-Path $script:Tmp "jbk"
    New-Item -ItemType Directory -Force -Path (Join-Path $d "job-applications"), (Join-Path $b "job-applications") | Out-Null
    Set-Content -NoNewline -Path (Join-Path $b "narnia-boot-x.sqlite") -Value "backup"
    Set-Content -NoNewline -Path (Join-Path $b "job-applications/a1") -Value "email"
    Set-Content -NoNewline -Path (Join-Path $b "job-applications/a2") -Value "video-backup"
    Set-Content -NoNewline -Path (Join-Path $d "job-applications/a2") -Value "video-atual"
    Restore-Files $d $b (Join-Path $b "narnia-boot-x.sqlite") "STAMP"
    Get-Content -Raw (Join-Path $d "job-applications/a1") | Should -Be "email"
    Get-Content -Raw (Join-Path $d "job-applications/a2") | Should -Be "video-atual"
  }
}

Describe "Regressão 2026-10-10: imagem antiga e volume do gh com dono root" {
  It "Send-HostGhToken corrige o dono da pasta do gh como root antes de gravar" {
    $script:calls = [System.Collections.Generic.List[string]]::new()
    function global:docker { $script:calls.Add(($args -join " ")); $global:LASTEXITCODE = 0 }
    function global:Get-HostGhToken { "gho_tokenDoHost" }
    try {
      Send-HostGhToken @("compose", "-f", "docker-compose.dev.yml") "dev"
      $chown = [array]::FindIndex($script:calls.ToArray(), [Predicate[string]] { param($c) $c -match "--user root" -and $c -match "chown node:node /home/node/.config/gh" })
      $write = [array]::FindIndex($script:calls.ToArray(), [Predicate[string]] { param($c) $c -match "host-token" })
      $chown | Should -BeGreaterOrEqual 0
      $chown | Should -BeLessThan $write
    } finally { Remove-Item function:global:docker, function:global:Get-HostGhToken -ErrorAction SilentlyContinue }
  }
  It "dev reconstrói as imagens antes de subir" {
    (Get-Content (Join-Path $PSScriptRoot "../../start.ps1") -Raw) | Should -Match '"dev"\s*\{\s*\r?\n\s*Assert-Docker\s*\r?\n\s*Invoke-DevBuild'
  }
}

Describe "C7 / CM-4: cópia separada da instância do dono (.owner-src)" {
  BeforeAll { $script:Ps1 = Join-Path $PSScriptRoot "../../start.ps1" }
  It "instância do dono usa .owner-src quando existe" {
    $dir = Join-Path $script:Tmp "src"; New-Item -ItemType Directory -Force -Path $dir | Out-Null
    # o BeforeAll já carregou o start.ps1: com a .owner-src real presente (depois do 1º promote), NARNIA_SRC_DIR vem setada
    $saved = $env:NARNIA_SRC_DIR; Remove-Item env:NARNIA_SRC_DIR -ErrorAction SilentlyContinue
    $env:NARNIA_OWNER_SRC_DIR = $dir
    try { $out = pwsh -NoProfile -Command ". '$($script:Ps1)'; `$env:NARNIA_SRC_DIR" }
    finally { Remove-Item env:NARNIA_OWNER_SRC_DIR -ErrorAction SilentlyContinue; if ($saved) { $env:NARNIA_SRC_DIR = $saved } }
    $out | Should -Be $dir
  }
  It "instância claude nunca usa .owner-src e monta os próprios dados" {
    $dir = Join-Path $script:Tmp "src2"; New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $env:NARNIA_OWNER_SRC_DIR = $dir; $env:NARNIA_INSTANCE = "claude"
    try { $out = pwsh -NoProfile -Command ". '$($script:Ps1)'; '{0}|{1}|{2}' -f `$env:NARNIA_SRC_DIR, `$env:NARNIA_DATA_MOUNT, `$env:NARNIA_BACKUP_MOUNT" }
    finally { Remove-Item env:NARNIA_OWNER_SRC_DIR, env:NARNIA_INSTANCE, env:NARNIA_SRC_DIR, env:NARNIA_DATA_MOUNT, env:NARNIA_BACKUP_MOUNT, env:NARNIA_DEV_PROJECT_NAME, env:NARNIA_PROD_PROJECT_NAME -ErrorAction SilentlyContinue }
    $out | Should -Be ".|./.claude-data/dev|./.claude-data/backups"
  }
  It "promote com árvore suja leva só o commit e avisa (pedido do dono, 2026-11-04)" -Skip:(-not (Get-Command git -ErrorAction SilentlyContinue)) {
    $repo = Join-Path $script:Tmp "repo-sujo"; New-Item -ItemType Directory -Force -Path $repo | Out-Null
    git -C $repo init -q; git -C $repo config user.email t@t; git -C $repo config user.name t
    Set-Content -Path (Join-Path $repo "a.txt") -Value "a"; git -C $repo add a.txt; git -C $repo commit -qm um
    Set-Content -Path (Join-Path $repo "a.txt") -Value "mudou"
    try { $out = pwsh -NoProfile -Command "Set-Location '$repo'; . '$($script:Ps1)'; Invoke-Promote" 2>&1 | Out-String }
    finally { Remove-Item env:NARNIA_SRC_DIR, env:NARNIA_DATA_MOUNT, env:NARNIA_BACKUP_MOUNT, env:NARNIA_DEV_PROJECT_NAME, env:NARNIA_PROD_PROJECT_NAME -ErrorAction SilentlyContinue }
    $out | Should -Match "ficam de fora"
    (git -C (Join-Path $repo ".owner-src") rev-parse HEAD) | Should -Be (git -C $repo rev-parse HEAD)
    (Get-Content (Join-Path $repo ".owner-src/a.txt")) | Should -Be "a"
  }
  It "promote recusa pela instância claude" {
    $env:NARNIA_INSTANCE = "claude"
    try { $out = pwsh -NoProfile -Command ". '$($script:Ps1)'; try { Invoke-Promote } catch { `$_.Exception.Message }" 2>&1 | Out-String }
    finally { Remove-Item env:NARNIA_INSTANCE, env:NARNIA_SRC_DIR, env:NARNIA_DATA_MOUNT, env:NARNIA_BACKUP_MOUNT, env:NARNIA_DEV_PROJECT_NAME, env:NARNIA_PROD_PROJECT_NAME -ErrorAction SilentlyContinue }
    $out | Should -Match "dono"
  }
  It "extension recusa código sem apps/extension (F12-10)" {
    $dir = Join-Path $script:Tmp "sem-ext"; New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $env:NARNIA_SRC_DIR = $dir
    try { $out = pwsh -NoProfile -Command ". '$($script:Ps1)'; Invoke-Extension" 2>&1 | Out-String }
    finally { Remove-Item env:NARNIA_SRC_DIR -ErrorAction SilentlyContinue }
    $out | Should -Match "apps/extension"
  }
}

Describe "F04/M5 · modo B (install-plugin e diagnóstico no host)" {
  BeforeAll {
    $script:Calls = [System.Collections.Generic.List[string]]::new()
    $script:McpGet = ""; $script:PluginList = ""
    $global:NarniaClaudeCliOverride = { param([string[]] $Arguments)
      $script:Calls.Add(($Arguments -join " "))
      $cmd = ($Arguments[0..1] -join " ")
      if ($cmd -eq "mcp get") { if ($script:McpGet) { $global:LASTEXITCODE = 0; return $script:McpGet } else { $global:LASTEXITCODE = 1; return "" } }
      if ($cmd -eq "plugin list") { $global:LASTEXITCODE = 0; return $script:PluginList }
      $global:LASTEXITCODE = 0
    }
  }
  AfterAll { Remove-Variable -Scope Global -Name NarniaClaudeCliOverride -ErrorAction SilentlyContinue }
  It "nomes padrão do dono" {
    Get-McpServerName | Should -Be "narnia-jobs"
    Get-PluginMarketplaceName | Should -Be "narnia-jobs-local"
    Get-PluginEndpoint "dev" | Should -Be "http://127.0.0.1:3100|dev-token"
  }
  It "Build-PluginStage grava .narnia-env, o cabeçalho do MCP e o marketplace local, com o agente da api e sem .mcp.json" {
    $global:NarniaPluginAgentOverride = { param($Url, $Token, $Name) "---`nname: recrutador`ntools: mcp__${Name}__*, WebSearch, WebFetch`n---`n`ncorpo renderizado`n" }
    try {
      $stage = Join-Path $script:Tmp "stage"
      Build-PluginStage (Join-Path $PSScriptRoot "../../plugin") $stage "http://127.0.0.1:3100" "dev-token" "narnia-jobs-local" "narnia-jobs"
      (Get-Content (Join-Path $stage "plugin/.narnia-env")) | Should -Contain "NARNIA_API_URL=http://127.0.0.1:3100"
      (Get-Content (Join-Path $stage ".claude-plugin/marketplace.json") -Raw) | Should -Match '"source": "./plugin"'
      Test-Path (Join-Path $stage "plugin/.mcp.json") | Should -BeFalse
      Test-Path (Join-Path $stage "plugin/.mcp.json.template") | Should -BeFalse
      (Get-Content (Join-Path $stage "plugin/agents/recrutador.md") -Raw) | Should -Match 'tools: mcp__narnia-jobs__\*'
      (Get-ChildItem -Recurse -File $stage | Select-String -SimpleMatch '{{') | Should -BeNullOrEmpty
      (Get-Content (Join-Path $stage "mcp-headers.json") -Raw).Trim() | Should -Be '{"Authorization":"Bearer dev-token"}'
    } finally { Remove-Variable -Scope Global -Name NarniaPluginAgentOverride -ErrorAction SilentlyContinue }
  }
  It "Install-PluginWith registra o MCP pelo headersHelper (sem token na linha de comando) e instala pelo marketplace local" {
    $script:Calls.Clear()
    $stage = Join-Path $script:Tmp "stage"
    Install-PluginWith $stage "narnia-jobs" "http://127.0.0.1:3100" "narnia-jobs-local" | Out-Null
    ($script:Calls | Where-Object { $_ -like "mcp add-json -s user narnia-jobs *headersHelper*mcp-headers.json*" }) | Should -Not -BeNullOrEmpty
    ($script:Calls -join "`n") | Should -Not -Match "dev-token"
    $script:Calls | Should -Contain "plugin install narnia-jobs@narnia-jobs-local --scope user"
  }
  It "Test-PluginInstall acusa porta mudou e plugin ausente" {
    $script:McpGet = "URL: http://127.0.0.1:3999/mcp"; $script:PluginList = "[]"
    $out = Test-PluginInstall "narnia-jobs" "http://127.0.0.1:3100" "narnia-jobs-local" | Out-String
    $out | Should -Match "porta mudou"
    $out | Should -Match "não instalado"
  }
}

Describe "Invoke-Evals (avaliações no Phoenix, M5)" {
  BeforeEach {
    $script:Calls = @()
    $script:ApiUp = $true
    function global:docker {
      $line = $args -join " "
      $script:Calls += $line
      if ($line -like "*ps -q api*" -and $script:ApiUp) { "abc123" }
    }
  }
  AfterEach { Remove-Item function:global:docker -ErrorAction SilentlyContinue }
  It "sem 'prompts' explica o uso" { { Invoke-Evals @() } | Should -Throw "*evals prompts*" }
  It "com o api de dev no ar, roda o comando dentro dele repassando os argumentos" {
    Invoke-Evals @("prompts", "extract-facts", "--strict")
    ($script:Calls -join "`n") | Should -Match "exec -T api pnpm --filter @narnia-jobs/api exec tsx src/cli.ts evals prompts extract-facts --strict"
  }
  It "chat e all também valem" {
    Invoke-Evals @("chat", "pontos-fracos")
    ($script:Calls -join "`n") | Should -Match "src/cli.ts evals chat pontos-fracos"
  }
  It "sem a aplicação no ar, pede para subir" {
    $script:ApiUp = $false
    { Invoke-Evals @("prompts") } | Should -Throw "*suba a aplicação*"
  }
}

Describe "Set-HostUser (containers com o uid de quem chama)" {
  It "usa o uid e o gid do usuário quando o id existe" -Skip:(-not (Get-Command id -ErrorAction SilentlyContinue)) {
    $old = $env:NARNIA_UID, $env:NARNIA_GID
    try {
      Remove-Item Env:NARNIA_UID, Env:NARNIA_GID -ErrorAction SilentlyContinue
      Set-HostUser
      $env:NARNIA_UID | Should -Be "$(& id -u)"
      $env:NARNIA_GID | Should -Be "$(& id -g)"
    } finally { $env:NARNIA_UID, $env:NARNIA_GID = $old }
  }
  It "respeita NARNIA_UID já definido" {
    $old = $env:NARNIA_UID
    try { $env:NARNIA_UID = "4242"; Set-HostUser; $env:NARNIA_UID | Should -Be "4242" } finally { $env:NARNIA_UID = $old }
  }
}
