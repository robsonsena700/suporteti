#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não está instalado. Instale Node.js 24+ primeiro." >&2
  exit 1
fi

if command -v corepack >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@latest --activate
else
  npm i -g pnpm
fi

pnpm -v
pnpm install

