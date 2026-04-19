param(
  [string]$HostName = "177.104.190.211",
  [int]$Port = 22002,
  [string]$User = "root",
  [string]$KeyPath = "",
  [string]$RemoteBaseDir = "/opt/suporte-ti",
  [string]$ApiHealthUrl = "http://127.0.0.1:3001/api/healthz",
  [switch]$SkipBuild,
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

function ResolveKeyPath {
  param([string]$InputKeyPath)

  if (![string]::IsNullOrWhiteSpace($InputKeyPath) -and (Test-Path $InputKeyPath)) {
    return (Resolve-Path $InputKeyPath).Path
  }

  $sshDir = Join-Path $RepoRoot "lib\ssh"
  $candidates = @(
    (Join-Path $sshDir "id_rsa"),
    (Join-Path $sshDir "suporteTi"),
    (Join-Path $sshDir "id_ed25519")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      Write-Host "Aviso: usando chave SSH encontrada automaticamente: $candidate" -ForegroundColor Yellow
      return (Resolve-Path $candidate).Path
    }
  }

  if (Test-Path $sshDir) {
    $files = Get-ChildItem -Path $sshDir -File | Select-Object -ExpandProperty FullName
    if ($files.Count -gt 0) {
      throw "Chave SSH inválida/não encontrada em '$InputKeyPath'. Arquivos disponíveis em lib\\ssh:`n$($files -join "`n")"
    }
  }

  throw "Chave SSH não encontrada. Informe -KeyPath com o caminho da chave privada."
}

function Ssh {
  param([Parameter(Mandatory)][string]$RemoteCommand)
  $k = ""
  if (![string]::IsNullOrWhiteSpace($KeyPath)) {
    $k = "-i `"$KeyPath`""
  }
  & ssh -p $Port $k "$User@$HostName" $RemoteCommand
  if ($LASTEXITCODE -ne 0) {
    throw "Falha no ssh: $RemoteCommand"
  }
}

function ScpToRemote {
  param([Parameter(Mandatory)][string]$LocalPath, [Parameter(Mandatory)][string]$RemotePath)
  if (!(Test-Path $LocalPath)) {
    throw "Arquivo não encontrado: $LocalPath"
  }
  $k = ""
  if (![string]::IsNullOrWhiteSpace($KeyPath)) {
    $k = "-i `"$KeyPath`""
  }
  & scp -P $Port $k "$LocalPath" "${User}@${HostName}:$RemotePath"
  if ($LASTEXITCODE -ne 0) {
    throw "Falha no scp para $RemotePath"
  }
}

Write-Host "Deploy producao - alvo: ${User}@${HostName}:$Port"
$KeyPath = ResolveKeyPath -InputKeyPath $KeyPath

$dirty = ((& git status --porcelain 2>&1) | ForEach-Object { "$_" }) -join "`n"
if (!$AllowDirty -and $dirty.Trim().Length -gt 0) {
  throw "Existem alteracoes locais pendentes. Faca commit antes do deploy."
}
if ($AllowDirty -and $dirty.Trim().Length -gt 0) {
  Write-Host "Aviso: AllowDirty ativo — deploy com working tree sujo." -ForegroundColor Yellow
}

$appPkgPath = Join-Path (Get-Location) "artifacts\suporte-ti\package.json"
if (!(Test-Path $appPkgPath)) {
  throw "Não encontrei artifacts/suporte-ti/package.json"
}
$appPkg = Get-Content -Raw -Path $appPkgPath | ConvertFrom-Json
$version = [string]$appPkg.version
if ($version -notmatch "^\d+\.\d+\.\d+$") {
  throw "Versao invalida para deploy: '$version' (esperado MAJOR.MINOR.PATCH)."
}

if (!$SkipBuild) {
  Exec "pnpm run typecheck" | Out-Null
  Exec "pnpm run build" | Out-Null
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

tar -czf "$bundlePath" -C (Get-Location) "artifacts/suporte-ti/dist" "artifacts/api-server/dist" "artifacts/api-server/package.json" "artifacts/suporte-ti/package.json" | Out-Null

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

Write-Host "OK: deploy finalizado (v$version). Se precisar rollback, aponte o symlink current para previous e reinicie os servicos."
