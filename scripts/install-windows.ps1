Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is not installed. Install Node.js 24+ first."
}

if (Get-Command corepack -ErrorAction SilentlyContinue) {
  corepack enable
  corepack prepare pnpm@latest --activate
} else {
  npm install -g pnpm
}

pnpm -v
pnpm install
Write-Host "Install completed successfully on Windows."