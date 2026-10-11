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
    $env:NARNIA_OWNER_SRC_DIR = $dir
    try { $out = pwsh -NoProfile -Command ". '$($script:Ps1)'; `$env:NARNIA_SRC_DIR" }
    finally { Remove-Item env:NARNIA_OWNER_SRC_DIR -ErrorAction SilentlyContinue }
    $out | Should -Be $dir
  }
  It "instância claude nunca usa .owner-src e monta os próprios dados" {
    $dir = Join-Path $script:Tmp "src2"; New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $env:NARNIA_OWNER_SRC_DIR = $dir; $env:NARNIA_INSTANCE = "claude"
    try { $out = pwsh -NoProfile -Command ". '$($script:Ps1)'; '{0}|{1}|{2}' -f `$env:NARNIA_SRC_DIR, `$env:NARNIA_DATA_MOUNT, `$env:NARNIA_BACKUP_MOUNT" }
    finally { Remove-Item env:NARNIA_OWNER_SRC_DIR, env:NARNIA_INSTANCE, env:NARNIA_SRC_DIR, env:NARNIA_DATA_MOUNT, env:NARNIA_BACKUP_MOUNT, env:NARNIA_DEV_PROJECT_NAME, env:NARNIA_PROD_PROJECT_NAME -ErrorAction SilentlyContinue }
    $out | Should -Be ".|./.claude-data/dev|./.claude-data/backups"
  }
  It "promote recusa pela instância claude" {
    $env:NARNIA_INSTANCE = "claude"
    try { $out = pwsh -NoProfile -Command ". '$($script:Ps1)'; try { Invoke-Promote } catch { `$_.Exception.Message }" 2>&1 | Out-String }
    finally { Remove-Item env:NARNIA_INSTANCE, env:NARNIA_SRC_DIR, env:NARNIA_DATA_MOUNT, env:NARNIA_BACKUP_MOUNT, env:NARNIA_DEV_PROJECT_NAME, env:NARNIA_PROD_PROJECT_NAME -ErrorAction SilentlyContinue }
    $out | Should -Match "dono"
  }
}
