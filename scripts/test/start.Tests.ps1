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
