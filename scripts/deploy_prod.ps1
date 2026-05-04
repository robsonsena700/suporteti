param(
  [string]$HostName = "177.104.190.211",
  [int]$Port = 22002,
  [string]$User = "whs",
  [string]$KeyPath = "",
  [string]$RemoteBaseDir = "/home/whs/suporte-ti",
  [string]$ApiHealthUrl = "http://127.0.0.1:3001/api/healthz",
  [switch]$SkipBuild,
  [switch]$AllowDirty,
  [switch]$SkipRestart,
  [switch]$SkipHealthCheck,
  [switch]$StartAfterDeploy,
  [string]$StartScriptPath = "",
  [switch]$SkipMigrations
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

  $inputWasEmpty = [string]::IsNullOrWhiteSpace($InputKeyPath)

  if ($inputWasEmpty) {
    return ""
  }
  throw "Chave SSH não encontrada. Informe -KeyPath com o caminho da chave privada."
}

function Ssh {
  param([Parameter(Mandatory)][string]$RemoteCommand)
  $sshArgs = @(
    "-p", "$Port",
    "-o", "BatchMode=no",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3"
  )
  if (![string]::IsNullOrWhiteSpace($KeyPath)) {
    $sshArgs += @("-i", $KeyPath, "-o", "IdentitiesOnly=yes")
  }
  $sshArgs += @("$User@$HostName", $RemoteCommand)
  & ssh.exe @sshArgs
  if ($LASTEXITCODE -ne 0) {
    $keyInfo = if ([string]::IsNullOrWhiteSpace($KeyPath)) { "(nenhuma chave explicitada)" } else { $KeyPath }
    throw "Falha no ssh (${User}@${HostName}:$Port, key=$keyInfo): $RemoteCommand"
  }
}

function ScpToRemote {
  param([Parameter(Mandatory)][string]$LocalPath, [Parameter(Mandatory)][string]$RemotePath)
  if (!(Test-Path $LocalPath)) {
    throw "Arquivo não encontrado: $LocalPath"
  }
  $scpArgs = @(
    "-P", "$Port",
    "-o", "BatchMode=no",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3"
  )
  if (![string]::IsNullOrWhiteSpace($KeyPath)) {
    $scpArgs += @("-i", $KeyPath, "-o", "IdentitiesOnly=yes")
  }
  $scpArgs += @("$LocalPath", "${User}@${HostName}:$RemotePath")
  & scp.exe @scpArgs
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
  Write-Host "Aviso: AllowDirty ativo - deploy com working tree sujo." -ForegroundColor Yellow
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
  Exec "pnpm run typecheck:libs" | Out-Null
  Exec "pnpm --filter @workspace/api-server --if-present run typecheck" | Out-Null
  Exec "pnpm --filter @workspace/suporte-ti --if-present run typecheck" | Out-Null
  Exec "pnpm --filter @workspace/api-server --if-present run build" | Out-Null
  Exec "pnpm --filter @workspace/suporte-ti --if-present run build" | Out-Null
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

$bundleItems = @(
  "artifacts/suporte-ti/dist",
  "artifacts/api-server/dist",
  "artifacts/api-server/package.json",
  "artifacts/suporte-ti/package.json"
)
if (Test-Path (Join-Path (Get-Location) "lib/db/migrations")) {
  $bundleItems += "lib/db/migrations"
}
if (Test-Path (Join-Path (Get-Location) "scripts/remote/apply_sql_migrations.sh")) {
  $bundleItems += "scripts/remote/apply_sql_migrations.sh"
}

& tar -czf "$bundlePath" -C (Get-Location) @bundleItems | Out-Null

$releasesDir = "$RemoteBaseDir/releases"
$releaseDir = "$releasesDir/$version"
$currentLink = "$RemoteBaseDir/current"
$previousLink = "$RemoteBaseDir/previous"

Ssh "mkdir -p $releasesDir"
ScpToRemote -LocalPath $bundlePath -RemotePath "/tmp/$bundleName"
Ssh "set -e; mkdir -p $releaseDir; tar -xzf /tmp/$bundleName -C $releaseDir; rm -f /tmp/$bundleName"

$switchCmd = 'set -e; if [ -L "{0}" ]; then rm -f "{1}"; ln -s $(readlink "{0}") "{1}"; fi; rm -f "{0}"; ln -s "{2}" "{0}"' -f $currentLink, $previousLink, $releaseDir
$serviceCmd = 'set -e; if command -v systemctl >/dev/null 2>&1; then systemctl restart suporte-ti-api || true; systemctl restart suporte-ti-web || true; fi'
$healthCmd = 'set -e; if command -v curl >/dev/null 2>&1; then curl -fsS "{0}" >/dev/null; fi' -f $ApiHealthUrl
$shouldStart = if ($PSBoundParameters.ContainsKey("StartAfterDeploy")) { [bool]$StartAfterDeploy } else { $User -ne "root" }
$resolvedStartScriptPath = if (![string]::IsNullOrWhiteSpace($StartScriptPath)) { $StartScriptPath } else { "$RemoteBaseDir/shared/start_prod.sh" }
$startCmd = 'set -e; if [ -x "{0}" ]; then bash "{0}" "{1}"; else echo "start_prod.sh nao encontrado: {0}" >&2; exit 2; fi' -f $resolvedStartScriptPath, $RemoteBaseDir
$migrateCmd = 'set -e; if [ -d "{0}/lib/db/migrations" ] && [ -f "{0}/scripts/remote/apply_sql_migrations.sh" ]; then sed -i ''s/\r$//'' "{0}/scripts/remote/apply_sql_migrations.sh"; chmod +x "{0}/scripts/remote/apply_sql_migrations.sh"; "{0}/scripts/remote/apply_sql_migrations.sh" "{0}/lib/db/migrations"; fi' -f $releaseDir

if ($shouldStart -and [string]::IsNullOrWhiteSpace($StartScriptPath)) {
  $localStartScript = Join-Path (Get-Location) "scripts\remote\start_prod.sh"
  if (!(Test-Path $localStartScript)) {
    throw "Não encontrei o script local: $localStartScript"
  }
  $remoteSharedDir = "$RemoteBaseDir/shared"
  Ssh "mkdir -p $remoteSharedDir"
  ScpToRemote -LocalPath $localStartScript -RemotePath "$remoteSharedDir/start_prod.sh"
  Ssh "set -e; sed -i 's/\\r\$//' '$remoteSharedDir/start_prod.sh'; chmod +x '$remoteSharedDir/start_prod.sh'"
}

if (!$SkipMigrations) {
  try {
    Ssh $migrateCmd
  } catch {
    Write-Host "Aviso: falha ao aplicar migrations SQL automaticamente." -ForegroundColor Yellow
  }
}

Ssh $switchCmd
if (!$SkipRestart -and !$shouldStart) {
  try {
    Ssh $serviceCmd
  } catch {
    Write-Host "Aviso: falha ao reiniciar servicos via systemctl." -ForegroundColor Yellow
  }
}
if ($shouldStart) {
  Ssh $startCmd
}
if (!$SkipHealthCheck) {
  try {
    Ssh $healthCmd
  } catch {
    Write-Host "Aviso: healthcheck falhou (API pode nao estar exposta/ativa ainda)." -ForegroundColor Yellow
  }
}

Write-Host "OK: deploy finalizado (v$version). Se precisar rollback, aponte o symlink current para previous e reinicie os servicos."
