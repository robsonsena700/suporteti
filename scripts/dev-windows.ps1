$ErrorActionPreference = "Stop"

if (-not $env:PG_PASSWORD) {
  Write-Host "Defina a senha do PostgreSQL antes de executar." -ForegroundColor Yellow
  Write-Host "Exemplo: `$env:PG_PASSWORD = 'sua_senha'" -ForegroundColor Yellow
  exit 1
}

$pgUser = if ($env:PG_USER) { $env:PG_USER } else { "postgres" }
$pgHost = if ($env:PG_HOST) { $env:PG_HOST } else { "localhost" }
$pgPort = if ($env:PG_PORT) { $env:PG_PORT } else { "5445" }
$pgDatabase = if ($env:PG_DATABASE) { $env:PG_DATABASE } else { "suporteti" }

$encodedPassword = [System.Uri]::EscapeDataString($env:PG_PASSWORD)
$env:DATABASE_URL = "postgresql://${pgUser}:${encodedPassword}@${pgHost}:${pgPort}/${pgDatabase}"

Write-Host "DATABASE_URL configurada para ${pgUser}@${pgHost}:${pgPort}/${pgDatabase}" -ForegroundColor Green
pnpm run dev
