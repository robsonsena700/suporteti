param(
  [ValidateSet("patch", "minor", "major")][string]$Bump = "patch",
  [string]$Remote = "origin",
  [string]$BaseBranch = "main",
  [string]$HeadBranch = "",
  [ValidateSet("merge", "rebase")][string]$SyncMode = "merge",
  [switch]$Yes,
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

ExecGit @("checkout", $HeadBranch) | Out-Null
ExecGit @("pull", $Remote, $HeadBranch) | Out-Null

$status = (ExecGit @("status", "--porcelain"))
if ($status.Trim().Length -gt 0) {
  AssertNoSecretsInStatus -StatusText $status
  Write-Host "Alterações detectadas:" -ForegroundColor Yellow
  Write-Host $status -ForegroundColor Yellow
  ConfirmOrThrow -Message "Confirmar commit automático de todas as alterações na branch $HeadBranch?"
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

if (-not $SkipBuild) {
  Exec "pnpm run typecheck" | Out-Null
  Exec "pnpm run build" | Out-Null
}

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

  ExecGit @("add", "artifacts/suporte-ti/package.json") | Out-Null
  ExecGit @("commit", "-m", "chore(release): v$newVersion") | Out-Null
  ExecGit @("push", $Remote, $HeadBranch) | Out-Null
} else {
  Write-Host "Aviso: SkipBump ativo - mantendo versão atual: v$newVersion" -ForegroundColor Yellow
}

if (-not $SkipPr) {
  $hasGh = $false
  try { & gh --version *> $null; $hasGh = ($LASTEXITCODE -eq 0) } catch { $hasGh = $false }
  if ($hasGh) {
    Write-Host ">> gh pr create --base $BaseBranch --head $HeadBranch"
    & gh pr create --base $BaseBranch --head $HeadBranch --title "Deploy: $HeadBranch -> $BaseBranch" --body "Automação via scripts/publicar.ps1 (v$newVersion)" 2>$null
  } else {
    Write-Host "GitHub CLI (gh) não encontrado. Crie o PR manualmente no GitHub:" -ForegroundColor Yellow
    Write-Host "Base: $BaseBranch"
    Write-Host "Head: $HeadBranch"
  }
}

if (-not $SkipDeploy) {
  $args = @(
    "-ExecutionPolicy", "Bypass",
    "-File", ".\scripts\deploy_prod.ps1",
    "-HostName", $HostName,
    "-Port", "$Port",
    "-User", $User,
    "-RemoteBaseDir", $RemoteBaseDir,
    "-SkipBuild"
  )
  if (-not [string]::IsNullOrWhiteSpace($KeyPath)) { $args += @("-KeyPath", $KeyPath) }

  Write-Host ">> deploy_prod.ps1"
  & powershell @args
  if ($LASTEXITCODE -ne 0) { throw "Falha no deploy_prod.ps1" }
  Write-Host "OK: publicado (v$newVersion)." -ForegroundColor Green
}

