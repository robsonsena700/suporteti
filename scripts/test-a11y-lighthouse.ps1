$ErrorActionPreference = "Stop"

$Port = 4173
$Url = "http://127.0.0.1:$Port/preview/prioridades"
$OutFile = "artifacts/suporte-ti/lighthouse-a11y.json"

function Wait-HttpOk {
  param([Parameter(Mandatory)][string]$Url, [int]$TimeoutMs = 30000)

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method GET -TimeoutSec 2 -MaximumRedirection 5
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) { return }
    } catch { }
    Start-Sleep -Milliseconds 300
  }
  throw "Timeout aguardando $Url"
}

if (!(Test-Path "artifacts/suporte-ti")) {
  New-Item -ItemType Directory -Force -Path "artifacts/suporte-ti" | Out-Null
}

Write-Host "Iniciando preview server (suporte-ti) na porta $Port..." -ForegroundColor Cyan
$cmd = @"
cd 'artifacts/suporte-ti';
pnpm --filter @workspace/suporte-ti exec vite preview --config vite.config.ts --host 127.0.0.1 --port $Port --strictPort
"@

$server = Start-Process -PassThru -NoNewWindow -FilePath "powershell" -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-Command", $cmd
)

try {
  Wait-HttpOk -Url $Url -TimeoutMs 30000

  Write-Host "Rodando Lighthouse (acessibilidade)..." -ForegroundColor Cyan
  & pnpm dlx lighthouse $Url `
    --only-categories=accessibility `
    --chrome-flags="--headless=new" `
    --output=json `
    --output-path="$OutFile" `
    --quiet | Out-Null

  $json = Get-Content -Raw -Path $OutFile | ConvertFrom-Json
  $score = $json.categories.accessibility.score
  if ($null -eq $score) { throw "Score de acessibilidade não encontrado no relatório." }

  $pct = [Math]::Round(($score * 100), 0)
  if ($pct -lt 95) { throw "Acessibilidade abaixo do alvo: $pct (< 95)" }

  Write-Host "Lighthouse A11y OK: $pct (>= 95)" -ForegroundColor Green
} finally {
  if ($server -and !$server.HasExited) {
    Stop-Process -Id $server.Id -Force
  }
}
