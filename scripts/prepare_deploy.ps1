param(
  [ValidateSet("patch", "minor", "major")][string]$Bump = "patch",
  [string]$Remote = "origin",
  [string]$MainBranch = "main",
  [string]$DevelopBranch = "",
  [ValidateSet("merge", "rebase")][string]$SyncMode = "merge",
  [switch]$AllowDirty
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
  if ($code -ne 0) {
    throw "Falha ao executar git $($Args -join ' ')`n$text"
  }
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
  if ($code -ne 0) {
    throw "Falha ao executar: $Command`n$text"
  }
  return $text
}

function EnsureCleanWorkingTree {
  if ($AllowDirty) {
    Write-Host "Aviso: AllowDirty ativo - ignorando working tree sujo." -ForegroundColor Yellow
    return
  }
  $status = ((& git status --porcelain 2>&1) | ForEach-Object { "$_" }) -join "`n"
  $status = $status.Trim()
  if ($status.Length -gt 0) {
    Write-Host "Alteracoes detectadas:" -ForegroundColor Yellow
    Write-Host $status -ForegroundColor Yellow
    throw "Existem alteracoes locais pendentes. Faca commit/stash antes de preparar deploy."
  }
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

  throw "Branch nao encontrada: $Branch (nem local, nem em $Remote)."
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

function EnsureBranch {
  param([Parameter(Mandatory)][string]$Branch)
  $current = (ExecGit @("rev-parse", "--abbrev-ref", "HEAD")).Trim()
  if ($current -ne $Branch) {
    ExecGit @("checkout", $Branch) | Out-Null
  }
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
  throw "Versao invalida: '$Version'. Esperado MAJOR.MINOR.PATCH (opcional prefixo v)."
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
  if (!(Test-Path $Path)) { throw "Arquivo nao encontrado: $Path" }
  return (Get-Content -Raw -Path $Path) | ConvertFrom-Json
}

function WriteJsonFile {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][object]$Object)
  $json = $Object | ConvertTo-Json -Depth 100
  $json = ($json -replace "\r?\n", "`n") + "`n"
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function ResolveCommitRef {
  param([string]$Input, [string]$DefaultRef = "HEAD")

  if ([string]::IsNullOrWhiteSpace($Input)) {
    return (ExecGit @("rev-parse", $DefaultRef)).Trim()
  }

  $candidate = $Input.Trim()

  if ($candidate -match "^(?:v|V)?(\d+\.\d+\.\d+)$") {
    $ver = $Matches[1]
    $tagCandidates = @("v$ver", "V$ver")
    foreach ($tag in $tagCandidates) {
      $old = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      try {
        & git rev-parse --verify "$tag^{commit}" *> $null
        $ok = ($LASTEXITCODE -eq 0)
      } finally {
        $ErrorActionPreference = $old
      }
      if ($ok) {
        return (ExecGit @("rev-parse", $tag)).Trim()
      }
    }
  }

  # If the user typed an existing branch/tag/ref, resolve that exact ref first.
  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & git show-ref --verify --quiet "refs/heads/$candidate"
    $isLocalBranch = ($LASTEXITCODE -eq 0)
    if (-not $isLocalBranch) {
      & git show-ref --verify --quiet "refs/remotes/$Remote/$candidate"
      $isRemoteBranch = ($LASTEXITCODE -eq 0)
    } else {
      $isRemoteBranch = $false
    }
  } finally {
    $ErrorActionPreference = $old
  }
  if ($isLocalBranch) {
    return (ExecGit @("rev-parse", $candidate)).Trim()
  }
  if ($isRemoteBranch) {
    return (ExecGit @("rev-parse", "$Remote/$candidate")).Trim()
  }

  $old = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & git rev-parse --verify "$candidate^{commit}" *> $null
    $ok = ($LASTEXITCODE -eq 0)
  } finally {
    $ErrorActionPreference = $old
  }

  if ($ok) {
    return (ExecGit @("rev-parse", $candidate)).Trim()
  }

  $matchesRaw = & git log --all --max-count 20 --pretty=format:"%H`t%s" --grep $candidate -i 2>&1
  $lines = ($matchesRaw | ForEach-Object { "$_" }) | Where-Object { $_.Trim().Length -gt 0 }
  if (!$lines -or $lines.Count -eq 0) {
    throw "Commit invalido: '$candidate'. Informe hash, tag, branch ou um trecho da mensagem do commit."
  }

  if ($lines.Count -eq 1) {
    $parts = $lines[0].Split("`t", 2)
    Write-Host "Commit encontrado por mensagem: $($parts[1])" -ForegroundColor Yellow
    return $parts[0]
  }

  Write-Host "Mais de um commit corresponde a '$candidate'. Selecione:" -ForegroundColor Yellow
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $parts = $lines[$i].Split("`t", 2)
    $n = $i + 1
    Write-Host "[$n] $($parts[0].Substring(0, 7)) - $($parts[1])"
  }

  $choice = Read-Host "Escolha o numero (1-$($lines.Count))"
  $num = 0
  if (![int]::TryParse($choice, [ref]$num) -or $num -lt 1 -or $num -gt $lines.Count) {
    throw "Selecao invalida."
  }
  return $lines[$num - 1].Split("`t", 2)[0]
}

function ValidateCommitOnRemoteBranch {
  param([Parameter(Mandatory)][string]$Commit, [Parameter(Mandatory)][string]$RemoteBranch)
  $branches = ExecGit @("branch", "-r", "--contains", $Commit)
  if ($branches -notmatch [regex]::Escape($RemoteBranch)) {
    throw "Commit $Commit nao esta presente em $RemoteBranch."
  }
}

function GetLastVersionTag {
  $tags = ExecGit @("tag", "--list", "v[0-9]*.[0-9]*.[0-9]*", "--sort=-v:refname")
  return ($tags.Split("`n", [System.StringSplitOptions]::RemoveEmptyEntries) | Select-Object -First 1)
}

function GenerateChangelogSection {
  param([Parameter(Mandatory)][string]$NewVersion, [string]$SinceRef)
  $date = (Get-Date).ToString("yyyy-MM-dd")
  $range = if ($SinceRef) { "$SinceRef..HEAD" } else { "HEAD" }
  $lines = ExecGit @("log", $range, "--pretty=format:- %s (%h)")
  $entries = $lines.Split("`n", [System.StringSplitOptions]::RemoveEmptyEntries)
  $body = if ($entries.Length -gt 0) { ($entries -join "`n") } else { "- (sem commits)" }
  return "## v$NewVersion ($date)`n$body`n"
}

Write-Host "Preparacao de deploy - repositorio: $(Get-Location)"
EnsureCleanWorkingTree

ExecGit @("fetch", $Remote, "--prune") | Out-Null

if ([string]::IsNullOrWhiteSpace($DevelopBranch)) {
  $DevelopBranch = (ExecGit @("branch", "--show-current")).Trim()
}
if ($DevelopBranch -eq $MainBranch) {
  $localBranchesRaw = ExecGit @("branch", "--format=%(refname:short)")
  $candidates = $localBranchesRaw.Split("`n", [System.StringSplitOptions]::RemoveEmptyEntries) | Where-Object { $_ -and $_.Trim() -ne $MainBranch }
  $suggested = ($candidates | Select-Object -First 1)
  $prompt = if ($suggested) { "Informe a branch de desenvolvimento (ex: $suggested)" } else { "Informe a branch de desenvolvimento (ex: develop ou V1.0.0)" }
  $picked = Read-Host $prompt
  if (![string]::IsNullOrWhiteSpace($picked)) {
    $DevelopBranch = $picked.Trim()
  }
}
EnsureBranchExists -Branch $MainBranch
EnsureBranchExists -Branch $DevelopBranch
EnsureRemoteBranchExists -Branch $DevelopBranch

$inputCommit = Read-Host "Informe o hash/tag/branch do commit que deseja publicar (Enter = HEAD da branch de desenvolvimento ou digite parte da mensagem)"
$commit = ResolveCommitRef -Input $inputCommit -DefaultRef "$Remote/$DevelopBranch"

ValidateCommitOnRemoteBranch -Commit $commit -RemoteBranch "$Remote/$DevelopBranch"

$confirm = Read-Host "Confirmar publicação do commit ${commit}? (S/N)"
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

Exec "pnpm run typecheck:libs" | Out-Null
Exec "pnpm --filter @workspace/api-server --if-present run typecheck" | Out-Null
Exec "pnpm --filter @workspace/suporte-ti --if-present run typecheck" | Out-Null
Exec "pnpm --filter @workspace/api-server --if-present run build" | Out-Null
Exec "pnpm --filter @workspace/suporte-ti --if-present run build" | Out-Null

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
