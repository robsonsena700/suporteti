# Publicação em Produção

## Política de Segurança (Obrigatório)

- Não commitar credenciais, chaves SSH ou arquivos de senha no Git.
- Mantenha `lib/ssh/` e arquivos de credenciais sempre fora do repositório.

## Fluxo Recomendado

### 1) Preparar release (branch + versão + changelog)

Execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare_deploy.ps1 -Bump patch
```

O script:

- Solicita o hash do commit a publicar (interativo)
- Sincroniza `develop` com `main` via merge/rebase
- Roda `pnpm run typecheck` e `pnpm run build`
- Incrementa versão semântica em `artifacts/suporte-ti/package.json`
- Gera `CHANGELOG.md`
- Cria tag `vMAJOR.MINOR.PATCH` e faz push

### 2) Criar PR (MR) para main

Se tiver GitHub CLI (`gh`):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create_pr.ps1 -Base main -Head develop
```

### 3) Deploy em produção

Pré-requisito: autenticação por chave SSH (recomendado).

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy_prod.ps1 `
  -HostName 177.104.190.211 `
  -Port 22002 `
  -User root `
  -KeyPath "C:\Users\Robson Sena\Documents\SuporteTI\Suporte-Ti\lib\ssh\id_rsa"
```

O script realiza:

- Validação de pré-condições (repo limpo, versão semver)
- Build local (opcional `-SkipBuild`)
- Envio de bundle para o servidor
- Deploy por releases + symlink `current` e `previous`
- Restart de serviços (se `systemctl` existir) e health check

