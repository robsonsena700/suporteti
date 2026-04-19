param(
  [ValidateSet("patch", "minor", "major")][string]$Bump = "patch",
  [string]$Remote = "origin",
  [string]$MainBranch = "main",
  [string]$DevelopBranch = "",
  [ValidateSet("merge", "rebase")][string]$SyncMode = "merge"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

function Exec {
  param([Parameter(Mandatory)][string]$Command)
  Write-Host ">> $Command"
  $output = & powershell -NoProfile -Command $Command 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar: $Command`n$output"
  }
  return $output
}

function ExecGit {
  param([Parameter(Mandatory)][string[]]$Args)
  Write-Host (">> git " + ($Args -join " "))
  $output = & git @Args 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar git $($Args -join ' ')`n$output"
  }
  return $output
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

function ParseSemver {
  param([Parameter(Mandatory)][string]$Version)
  if ($Version -match "^(?:v|V)?(\d+)\.(\d+)\.(\d+)$") {
    return @{
      major = [int]$Matches[1]
      minor = [int]$Matches[2]
      patch = [int]$Matches[3]
    }
  }
  throw "Versão inválida: '$Version'. Esperado MAJOR.MINOR.PATCH (opcional prefixo v)."
}

function BumpSemver {
  param(
    [Parameter(Mandatory)][hashtable]$Semver,
    [ValidateSet("patch", "minor", "major")][string]$Bump = "patch"
  )
  $major = $Semver.major
  $minor = $Semver.minor
  $patch = $Semver.patch
  if ($Bump -eq "patch") { $patch++ }
  elseif ($Bump -eq "minor") { $minor++; $patch = 0 }
  elseif ($Bump -eq "major") { $major++; $minor = 0; $patch = 0 }
  return "$major.$minor.$patch"
}

function ReadJsonFile {
  param([Parameter(Mandatory)][string]$Path)
  if (!(Test-Path $Path)) { throw "Arquivo não encontrado: $Path" }
  $raw = Get-Content -Raw -Path $Path
  return $raw | ConvertFrom-Json
}

function WriteJsonFile {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][object]$Object
  )
  $json = $Object | ConvertTo-Json -Depth 100
  $json = ($json -replace "\r?\n", "`n") + "`n"
  Set-Content -Path $Path -Value $json -Encoding UTF8
}

function EnsureCleanWorkingTree {
  $status = ExecGit @("status", "--porcelain")
  if ($status.Trim().Length -gt 0) {
    throw "Existem alterações locais pendentes. Faça commit/stash antes de preparar deploy."
  }
}

function EnsureBranch {
  param([Parameter(Mandatory)][string]$Branch)
  $current = (ExecGit @("rev-parse", "--abbrev-ref", "HEAD")).Trim()
  if ($current -ne $Branch) {
    ExecGit @("checkout", $Branch) | Out-Null
  }
}

function ValidateCommitExists {
  param([Parameter(Mandatory)][string]$Commit)
  ExecGit @("cat-file", "-e", "$Commit^{commit}") | Out-Null
}

function ValidateCommitOnRemoteBranch {
  param(
    [Parameter(Mandatory)][string]$Commit,
    [Parameter(Mandatory)][string]$RemoteBranch
  )
  $branches = ExecGit @("branch", "-r", "--contains", $Commit)
  if ($branches -notmatch [regex]::Escape($RemoteBranch)) {
    throw "Commit $Commit não está presente em $RemoteBranch."
  }
}

function GetLastVersionTag {
  $tags = ExecGit @("tag", "--list", "v[0-9]*.[0-9]*.[0-9]*", "--sort=-v:refname")
  $first = $tags.Split("`n", [System.StringSplitOptions]::RemoveEmptyEntries) | Select-Object -First 1
  return $first
}

function GenerateChangelogSection {
  param(
    [Parameter(Mandatory)][string]$NewVersion,
    [string]$SinceRef
  )
  $date = (Get-Date).ToString("yyyy-MM-dd")
  $range = if ($SinceRef) { "$SinceRef..HEAD" } else { "HEAD" }
  $lines = ExecGit @("log", $range, "--pretty=format:- %s (%h)")
  $entries = $lines.Split("`n", [System.StringSplitOptions]::RemoveEmptyEntries)
  $body = if ($entries.Length -gt 0) { ($entries -join "`n") } else { "- (sem commits)" }
  return "## v$NewVersion ($date)`n$body`n"
}

Write-Host "Preparação de deploy - repositório: $(Get-Location)"
EnsureCleanWorkingTree

ExecGit @("fetch", $Remote, "--prune") | Out-Null

if ([string]::IsNullOrWhiteSpace($DevelopBranch)) {
  $DevelopBranch = (ExecGit @("branch", "--show-current")).Trim()
}
EnsureBranchExists -Branch $MainBranch
EnsureBranchExists -Branch $DevelopBranch

$commit = Read-Host "Informe o hash do commit que deseja publicar (Enter = HEAD)"
if ([string]::IsNullOrWhiteSpace($commit)) {
  $commit = (ExecGit @("rev-parse", "HEAD")).Trim()
}
ValidateCommitExists -Commit $commit

ValidateCommitOnRemoteBranch -Commit $commit -RemoteBranch "$Remote/$DevelopBranch"

$confirm = Read-Host "Confirmar publicação do commit $commit? (S/N)"
if ($confirm.Trim().ToUpper() -ne "S") {
  throw "Operação cancelada pelo usuário."
}

EnsureBranch -Branch $MainBranch
ExecGit @("pull", $Remote, $MainBranch) | Out-Null

EnsureBranch -Branch $DevelopBranch
ExecGit @("pull", $Remote, $DevelopBranch) | Out-Null

if ($SyncMode -eq "merge") {
  ExecGit @("merge", "$Remote/$MainBranch") | Out-Null
} else {
  ExecGit @("rebase", "$Remote/$MainBranch") | Out-Null
}

Exec "pnpm run typecheck" | Out-Null
Exec "pnpm run build" | Out-Null

$appPackagePath = Join-Path (Get-Location) "artifacts\suporte-ti\package.json"
$appPkg = ReadJsonFile -Path $appPackagePath
$currentVersion = [string]$appPkg.version
$parsed = ParseSemver -Version $currentVersion
$newVersion = BumpSemver -Semver $parsed -Bump $Bump

$appPkg.version = $newVersion
WriteJsonFile -Path $appPackagePath -Object $appPkg

$changelogPath = Join-Path (Get-Location) "CHANGELOG.md"
$lastTag = GetLastVersionTag
$section = GenerateChangelogSection -NewVersion $newVersion -SinceRef $lastTag

if (Test-Path $changelogPath) {
  $existing = Get-Content -Raw -Path $changelogPath
  $next = "# Changelog`n`n$section`n" + ($existing -replace "^\s*#\s*Changelog\s*", "" -replace "^\s*", "")
  Set-Content -Path $changelogPath -Value $next -Encoding UTF8
} else {
  Set-Content -Path $changelogPath -Value ("# Changelog`n`n$section") -Encoding UTF8
}

ExecGit @("add", $appPackagePath, $changelogPath) | Out-Null
ExecGit @("commit", "-m", "chore(release): v$newVersion") | Out-Null

$tag = "v$newVersion"
$existingTag = ExecGit @("tag", "--list", $tag)
if ($existingTag.Trim().Length -gt 0) {
  throw "Tag já existe: $tag"
}
ExecGit @("tag", $tag) | Out-Null

ExecGit @("push", $Remote, $DevelopBranch) | Out-Null
ExecGit @("push", $Remote, $tag) | Out-Null

Write-Host "OK: versão atualizada para v$newVersion, changelog gerado e tag criada."
Write-Host "Próximo passo: abrir PR/MR de $DevelopBranch -> $MainBranch e executar deploy_prod.ps1"
