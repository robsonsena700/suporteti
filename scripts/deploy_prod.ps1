param(
  [string]$HostName = "177.104.190.211",
  [int]$Port = 22002,
  [string]$User = "root",
  [string]$KeyPath = "",
  [string]$RemoteBaseDir = "/opt/suporte-ti",
  [string]$ApiHealthUrl = "http://127.0.0.1:3001/api/healthz",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

function Exec {
  param([Parameter(Mandatory)][string]$Command)
  Write-Host ">> $Command"
  & powershell -NoProfile -Command $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar: $Command"
  }
}

function ExecGit {
  param([Parameter(Mandatory)][string[]]$Args)
  Write-Host (">> git " + ($Args -join " "))
  & git @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar git $($Args -join ' ')"
  }
}

function RequireFile {
  param([Parameter(Mandatory)][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path) -or !(Test-Path $Path)) {
    throw "Arquivo não encontrado: $Path"
  }
}

function Ssh {
  param([Parameter(Mandatory)][string]$RemoteCommand)
  $k = ""
  if (![string]::IsNullOrWhiteSpace($KeyPath)) {
    RequireFile -Path $KeyPath
    $k = "-i `"$KeyPath`""
  }
  & ssh -p $Port $k "$User@$HostName" $RemoteCommand
  if ($LASTEXITCODE -ne 0) {
    throw "Falha no ssh: $RemoteCommand"
  }
}

function ScpToRemote {
  param(
    [Parameter(Mandatory)][string]$LocalPath,
    [Parameter(Mandatory)][string]$RemotePath
  )
  RequireFile -Path $LocalPath
  $k = ""
  if (![string]::IsNullOrWhiteSpace($KeyPath)) {
    RequireFile -Path $KeyPath
    $k = "-i `"$KeyPath`""
  }
  & scp -P $Port $k "$LocalPath" "${User}@${HostName}:$RemotePath"
  if ($LASTEXITCODE -ne 0) {
    throw "Falha no scp para $RemotePath"
  }
}

Write-Host "Deploy produção - alvo: ${User}@${HostName}:$Port"

ExecGit @("status", "--porcelain") | Out-Null
$dirty = (& git status --porcelain 2>&1) -join "`n"
if ($dirty.Trim().Length -gt 0) {
  throw "Existem alterações locais pendentes. Faça commit antes do deploy."
}

$appPkgPath = Join-Path (Get-Location) "artifacts\suporte-ti\package.json"
if (!(Test-Path $appPkgPath)) {
  throw "Não encontrei artifacts/suporte-ti/package.json"
}
$appPkg = Get-Content -Raw -Path $appPkgPath | ConvertFrom-Json
$version = [string]$appPkg.version
if ($version -notmatch "^\d+\.\d+\.\d+$") {
  throw "Versão inválida para deploy: '$version' (esperado MAJOR.MINOR.PATCH)."
}

if (!$SkipBuild) {
  Exec "pnpm run typecheck"
  Exec "pnpm run build"
}

$distDir = Join-Path (Get-Location) "artifacts\suporte-ti\dist"
if (!(Test-Path $distDir)) {
  throw "Build do frontend não encontrado: $distDir"
}

$apiDistDir = Join-Path (Get-Location) "artifacts\api-server\dist"
if (!(Test-Path $apiDistDir)) {
  throw "Build da API não encontrado: $apiDistDir"
}

$tmp = Join-Path (Get-Location) "tmp"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$bundleName = "suporte-ti_$version.tgz"
$bundlePath = Join-Path $tmp $bundleName
if (Test-Path $bundlePath) { Remove-Item -Force $bundlePath }

Push-Location (Get-Location)
try {
  $root = Get-Location
  Push-Location $root | Out-Null
  tar -czf "$bundlePath" -C "$root" "artifacts/suporte-ti/dist" "artifacts/api-server/dist" "artifacts/api-server/package.json" "artifacts/suporte-ti/package.json" | Out-Null
} finally {
  Pop-Location | Out-Null
}

$releasesDir = "$RemoteBaseDir/releases"
$releaseDir = "$releasesDir/$version"
$currentLink = "$RemoteBaseDir/current"
$previousLink = "$RemoteBaseDir/previous"

Ssh "mkdir -p $releasesDir"
ScpToRemote -LocalPath $bundlePath -RemotePath "/tmp/$bundleName"

Ssh "set -e; mkdir -p $releaseDir; tar -xzf /tmp/$bundleName -C $releaseDir; rm -f /tmp/$bundleName"

Ssh "set -e; if [ -L $currentLink ]; then rm -f $previousLink; ln -s \$(readlink $currentLink) $previousLink; fi; rm -f $currentLink; ln -s $releaseDir $currentLink"

Ssh "set -e; if command -v systemctl >/dev/null 2>&1; then systemctl restart suporte-ti-api || true; systemctl restart suporte-ti-web || true; fi"

Ssh "set -e; if command -v curl >/dev/null 2>&1; then curl -fsS $ApiHealthUrl >/dev/null; fi"

Write-Host "OK: deploy finalizado (v$version). Se precisar rollback, aponte o symlink current para previous e reinicie os serviços."
