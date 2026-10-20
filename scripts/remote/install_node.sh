#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="$HOME/.nvm"

if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi

source "$NVM_DIR/nvm.sh"

nvm install 24
nvm use 24
nvm alias default 24

node -v
npm -v

