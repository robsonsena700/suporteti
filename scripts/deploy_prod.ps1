param(
  [string]$HostName = "177.104.190.211",
  [int]$Port = 22002,
  [string]$User = "root",
  [string]$KeyPath = "",
  [string]$RemoteBaseDir = "/opt/suporte-ti",
  [string]$ApiHealthUrl = "http://127.0.0.1:3001/api/healthz",
  [switch]$SkipBuild,
  [switch]$AllowDirty,
  [switch]$StartAfterDeploy,
  [string]$StartScriptPath = ""
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

function ResolveKeyPath {
  param([string]$InputKeyPath)

  if (![string]::IsNullOrWhiteSpace($InputKeyPath) -and (Test-Path $InputKeyPath)) {
    return (Resolve-Path $InputKeyPath).Path
  }

  if ([string]::IsNullOrWhiteSpace($InputKeyPath)) {
    return ""
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

  throw "Chave SSH não encontrada. Informe -KeyPath com o caminho da chave privada ou deixe vazio para usar ssh-agent."
}

function InvokeRemoteCommand {
  param([Parameter(Mandatory)][string]$RemoteCommand)
  $sshArgs = @("-p", "$Port")
  if (![string]::IsNullOrWhiteSpace($KeyPath)) {
    RequireFile -Path $KeyPath
    $sshArgs += @("-i", $KeyPath)
  }
  $sshArgs += @("$User@$HostName", $RemoteCommand)
  & ssh.exe @sshArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Falha no ssh: $RemoteCommand"
  }
}

function CopyToRemote {
  param(
    [Parameter(Mandatory)][string]$LocalPath,
    [Parameter(Mandatory)][string]$RemotePath
  )
  RequireFile -Path $LocalPath
  $scpArgs = @("-P", "$Port")
  if (![string]::IsNullOrWhiteSpace($KeyPath)) {
    RequireFile -Path $KeyPath
    $scpArgs += @("-i", $KeyPath)
  }
  $scpArgs += @("$LocalPath", "${User}@${HostName}:$RemotePath")
  & scp.exe @scpArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Falha no scp para $RemotePath"
  }
}

Write-Host "Deploy produção - alvo: ${User}@${HostName}:$Port"

$KeyPath = ResolveKeyPath -InputKeyPath $KeyPath

ExecGit @("status", "--porcelain") | Out-Null
$dirty = (& git status --porcelain 2>&1) -join "`n"
if (!$AllowDirty -and $dirty.Trim().Length -gt 0) {
  throw "Existem alterações locais pendentes. Faça commit antes do deploy."
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

$mkdirCmd = "mkdir -p $releasesDir"
if ([string]::IsNullOrWhiteSpace($mkdirCmd)) {
  throw "Comando remoto de criacao de releases ficou vazio. Verifique RemoteBaseDir."
}
Write-Host ">> remote base: $RemoteBaseDir"
Write-Host ">> remote mkdir: $mkdirCmd"
InvokeRemoteCommand $mkdirCmd
CopyToRemote -LocalPath $bundlePath -RemotePath "/tmp/$bundleName"

InvokeRemoteCommand "set -e; mkdir -p $releaseDir; tar -xzf /tmp/$bundleName -C $releaseDir; rm -f /tmp/$bundleName"

$switchCmd = 'set -e; if [ -L "{0}" ]; then rm -f "{1}"; ln -s $(readlink "{0}") "{1}"; fi; rm -f "{0}"; ln -s "{2}" "{0}"' -f $currentLink, $previousLink, $releaseDir
$serviceCmd = 'set -e; if command -v systemctl >/dev/null 2>&1; then systemctl restart suporte-ti-api || true; systemctl restart suporte-ti-web || true; fi'
$healthCmd = 'set -e; if command -v curl >/dev/null 2>&1; then curl -fsS "{0}" >/dev/null; fi' -f $ApiHealthUrl

$shouldStart = if ($PSBoundParameters.ContainsKey("StartAfterDeploy")) { [bool]$StartAfterDeploy } else { $User -ne "root" }
$resolvedStartScriptPath = if (![string]::IsNullOrWhiteSpace($StartScriptPath)) { $StartScriptPath } else { "$RemoteBaseDir/shared/start_prod.sh" }
$startCmd = 'set -e; if [ -x "{0}" ]; then bash "{0}" "{1}"; else echo "start_prod.sh nao encontrado: {0}" >&2; exit 2; fi' -f $resolvedStartScriptPath, $RemoteBaseDir

InvokeRemoteCommand $switchCmd
InvokeRemoteCommand $serviceCmd
if ($shouldStart) {
  InvokeRemoteCommand $startCmd
}
InvokeRemoteCommand $healthCmd

Write-Host "OK: deploy finalizado (v$version). Se precisar rollback, aponte o symlink current para previous e reinicie os serviços."
