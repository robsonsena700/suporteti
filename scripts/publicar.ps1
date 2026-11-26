param(
  [ValidateSet("patch", "minor", "major")][string]$Bump = "patch",
  [string]$Remote = "origin",
  [string]$BaseBranch = "main",
  [string]$HeadBranch = "",
  [ValidateSet("merge", "rebase")][string]$SyncMode = "merge",
  [switch]$Yes,
  [switch]$CommitAll,
  [switch]$SkipBump,
  [switch]$SkipPr,
  [switch]$SkipDeploy,
  [switch]$SkipBuild,
  [string]$HostName = "177.104.190.211",
  [int]$Port = 22002,
  [string]$User = "whs",
  [string]$RemoteBaseDir = "/home/whs/suporte-ti",
  [string]$KeyPath = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

function ExecGit {
  param([Parameter(Mandatory)][string[]]$Args)
  Write-Host (">> git " + ($Args -join " "))
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & git @Args 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  $text = (($out | ForEach-Object { "$_" }) -join "`n").TrimEnd()
  if ($code -ne 0) { throw "Falha ao executar git $($Args -join ' ')`n$text" }
  return $text
}

function Exec {
  param([Parameter(Mandatory)][string]$Command)
  Write-Host ">> $Command"
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & powershell -NoProfile -Command $Command 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  $text = (($out | ForEach-Object { "$_" }) -join "`n").TrimEnd()
  if ($code -ne 0) { throw "Falha ao executar: $Command`n$text" }
  return $text
}

function EnsureBranchExists {
  param([Parameter(Mandatory)][string]$Branch)

  & git show-ref --verify --quiet "refs/heads/$Branch"
  if ($LASTEXITCODE -eq 0) { return }

  & git show-ref --verify --quiet "refs/remotes/$Remote/$Branch"
  if ($LASTEXITCODE -eq 0) {
    ExecGit @("checkout", "-b", $Branch, "$Remote/$Branch") | Out-Null
    return
  }

  throw "Branch não encontrada: $Branch (nem local, nem em $Remote)."
}

function EnsureRemoteBranchExists {
  param([Parameter(Mandatory)][string]$Branch)

  & git show-ref --verify --quiet "refs/remotes/$Remote/$Branch"
  if ($LASTEXITCODE -eq 0) { return }

  & git show-ref --verify --quiet "refs/heads/$Branch"
  if ($LASTEXITCODE -ne 0) {
    throw "Branch local não encontrada para publicar no remoto: $Branch"
  }

  Write-Host "Branch remota ausente ($Remote/$Branch). Publicando branch..." -ForegroundColor Yellow
  ExecGit @("push", "-u", $Remote, $Branch) | Out-Null
}

function ConfirmOrThrow {
  param([Parameter(Mandatory)][string]$Message)
  if ($Yes) { return }
  $ans = Read-Host "$Message (S/N)"
  if ($ans.Trim().ToUpper() -ne "S") { throw "Operação cancelada." }
}

function ParseSemver {
  param([Parameter(Mandatory)][string]$Version)
  if ($Version -match "^(?:v|V)?(\d+)\.(\d+)\.(\d+)$") {
    return @{ major = [int]$Matches[1]; minor = [int]$Matches[2]; patch = [int]$Matches[3] }
  }
  throw "Versão inválida: '$Version'. Esperado MAJOR.MINOR.PATCH."
}

function BumpSemver {
  param([Parameter(Mandatory)][hashtable]$Semver, [ValidateSet("patch", "minor", "major")][string]$Bump)
  $major = $Semver.major; $minor = $Semver.minor; $patch = $Semver.patch
  if ($Bump -eq "patch") { $patch++ }
  elseif ($Bump -eq "minor") { $minor++; $patch = 0 }
  elseif ($Bump -eq "major") { $major++; $minor = 0; $patch = 0 }
  return "$major.$minor.$patch"
}

function AssertNoSecretsInStatus {
  param([string]$StatusText)
  $blocked = @(
    "lib/ssh/",
    "credenciais.txt",
    ".env"
  )
  foreach ($b in $blocked) {
    if ($StatusText -match [regex]::Escape($b)) {
      throw "Arquivos sensíveis detectados no status ($b). Remova do commit antes de publicar."
    }
  }
}

Write-Host "Publicar - repositório: $(Get-Location)"

ExecGit @("fetch", $Remote, "--prune") | Out-Null

if ([string]::IsNullOrWhiteSpace($HeadBranch)) {
  $HeadBranch = (ExecGit @("branch", "--show-current")).Trim()
}
if ([string]::IsNullOrWhiteSpace($HeadBranch)) { throw "Informe -HeadBranch (ex: V1.0.2)" }
if ($HeadBranch -eq $BaseBranch) { throw "HeadBranch não pode ser igual à BaseBranch ($BaseBranch)." }

EnsureBranchExists -Branch $HeadBranch
EnsureRemoteBranchExists -Branch $HeadBranch
ExecGit @("checkout", $HeadBranch) | Out-Null
ExecGit @("pull", $Remote, $HeadBranch) | Out-Null

$status = (ExecGit @("status", "--porcelain"))
if ($status.Trim().Length -gt 0) {
  AssertNoSecretsInStatus -StatusText $status
  Write-Host "Alterações pendentes na branch ${HeadBranch}:" -ForegroundColor Yellow
  Write-Host $status -ForegroundColor Yellow
  # Antes o script fazia "git add -A" sempre que havia qualquer pendencia e
  # acabava publicando junto trabalho que nao tinha nada a ver com a entrega
  # (ex.: um app inteiro ainda nao comitado). Agora isso so acontece se for
  # pedido explicitamente com -CommitAll.
  if (-not $CommitAll) {
    throw "Há alterações não comitadas. Comite o que pertence a esta entrega, guarde o resto com 'git stash -u' e rode de novo (ou use -CommitAll para incluir tudo)."
  }
  ConfirmOrThrow -Message "Confirmar commit de TODAS as alterações acima na branch ${HeadBranch}?"
  ExecGit @("add", "-A") | Out-Null
  $msg = Read-Host "Mensagem do commit (Enter = 'chore: publicar')"
  if ([string]::IsNullOrWhiteSpace($msg)) { $msg = "chore: publicar" }
  ExecGit @("commit", "-m", $msg) | Out-Null
  ExecGit @("push", $Remote, $HeadBranch) | Out-Null
}

ExecGit @("checkout", $BaseBranch) | Out-Null
ExecGit @("pull", $Remote, $BaseBranch) | Out-Null

ExecGit @("checkout", $HeadBranch) | Out-Null
try {
  if ($SyncMode -eq "merge") {
    ExecGit @("merge", "$Remote/$BaseBranch") | Out-Null
  } else {
    ExecGit @("rebase", "$Remote/$BaseBranch") | Out-Null
  }
} catch {
  Write-Host "Conflito ao sincronizar com $BaseBranch. Resolva os conflitos e rode novamente." -ForegroundColor Yellow
  throw
}

# O bump de versao precisa acontecer ANTES do build: o Vite le
# artifacts/suporte-ti/package.json em tempo de build para definir
# __APP_VERSION__ (exibido como "Versao X.Y.Z" na tela de login e no
# rodape). Antes, o build rodava primeiro e o bump so depois - o pacote
# publicado sempre ficava com a versao ANTERIOR embutida, entao o numero
# mostrado em producao nunca refletia a versao de fato publicada/commitada
# e nao dava pra confirmar visualmente se um deploy realmente surtiu
# efeito. O commit do bump continua so depois de um build bem-sucedido
# (ErrorActionPreference Stop aborta o script antes do commit se o build
# falhar), pra nunca commitar um "chore(release)" de uma versao que nao
# foi de fato construida.
$appPkgPath = Join-Path (Get-Location) "artifacts\suporte-ti\package.json"
$appPkg = Get-Content -Raw -Path $appPkgPath | ConvertFrom-Json
$currentVersion = [string]$appPkg.version
$newVersion = $currentVersion
if (-not $SkipBump) {
  $newVersion = BumpSemver -Semver (ParseSemver -Version $currentVersion) -Bump $Bump
  Write-Host "Versão: $currentVersion -> $newVersion" -ForegroundColor Yellow
  ConfirmOrThrow -Message "Confirmar bump de versão?"
  $appPkg.version = $newVersion
  $json = $appPkg | ConvertTo-Json -Depth 100
  $json = ($json -replace "\r?\n", "`n") + "`n"
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($appPkgPath, $json, $utf8NoBom)
} else {
  Write-Host "Aviso: SkipBump ativo - mantendo versão atual: v$newVersion" -ForegroundColor Yellow
}

if (-not $SkipBuild) {
  Exec "pnpm run typecheck" | Out-Null
  Exec "pnpm run build" | Out-Null
}

if (-not $SkipBump) {
  ExecGit @("add", "artifacts/suporte-ti/package.json") | Out-Null
  ExecGit @("commit", "-m", "chore(release): v$newVersion") | Out-Null
  ExecGit @("push", $Remote, $HeadBranch) | Out-Null
}

if (-not $SkipPr) {
  $hasGh = $false
  try { & gh --version *> $null; $hasGh = ($LASTEXITCODE -eq 0) } catch { $hasGh = $false }
  if ($hasGh) {
    # O gh escreve avisos em stderr; com $ErrorActionPreference = "Stop" o
    # Windows PowerShell transformava isso em NativeCommandError e abortava o
    # script ANTES do deploy (mesmo com o PR criado). Agora o gh roda com
    # "Continue", o resultado e decidido pelo exit code e uma falha aqui so
    # gera aviso - nunca impede o deploy.
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $existingPr = (& gh pr list --base $BaseBranch --head $HeadBranch --state open --json url --jq ".[0].url" 2>$null | Out-String).Trim()
      if ($existingPr) {
        Write-Host "PR já aberto para $HeadBranch -> ${BaseBranch}: $existingPr" -ForegroundColor Yellow
      } else {
        Write-Host ">> gh pr create --base $BaseBranch --head $HeadBranch"
        $prOut = (& gh pr create --base $BaseBranch --head $HeadBranch --title "Deploy: $HeadBranch -> $BaseBranch" --body "Automação via scripts/publicar.ps1 (v$newVersion)" 2>&1 | ForEach-Object { "$_" }) -join "`n"
        if ($LASTEXITCODE -eq 0) {
          Write-Host $prOut.Trim() -ForegroundColor Green
        } else {
          Write-Host "Aviso: não foi possível criar o PR automaticamente:`n$prOut" -ForegroundColor Yellow
        }
      }
    } finally {
      $ErrorActionPreference = $old
    }
  } else {
    Write-Host "GitHub CLI (gh) não encontrado. Crie o PR manualmente no GitHub:" -ForegroundColor Yellow
    Write-Host "Base: $BaseBranch"
    Write-Host "Head: $HeadBranch"
  }
}

if (-not $SkipDeploy) {
  # Usamos splatting de hashtable (em vez de array) para evitar ambiguidade na
  # ligação de parâmetros nomeados do PowerShell - um array splatado pode, em
  # certas versões/condições, deslocar valores para o parâmetro errado (por
  # exemplo, o IP do -HostName acabando bindado em -Port, que é [int] e
  # quebra a conversão). Hashtable splatting liga sempre pelo nome, sem essa
  # ambiguidade.
  $deployArgs = @{
    HostName      = $HostName
    Port          = $Port
    User          = $User
    RemoteBaseDir = $RemoteBaseDir
    SkipBuild     = $true
  }
  if (-not [string]::IsNullOrWhiteSpace($KeyPath)) { $deployArgs["KeyPath"] = $KeyPath }

  Write-Host ">> deploy_prod.ps1"
  $deployScriptPath = Join-Path $RepoRoot "scripts\deploy_prod.ps1"
  & $deployScriptPath @deployArgs
  Write-Host "OK: publicado (v$newVersion)." -ForegroundColor Green
}

