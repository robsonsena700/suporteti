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

## Persistência do diretório uploads

### Objetivo

- Garantir que anexos (uploads) não sejam perdidos em deploys (deploy por releases troca `current`).

### Estratégia

- O diretório de uploads é mantido fora do release, em `shared/uploads`.
- A API usa `UPLOADS_DIR=/home/whs/suporte-ti/shared/uploads` (definido no `start_prod.sh`).

### Guard (backup + verificação + auditoria)

- Script no servidor: `shared/uploads_guard.sh`
- O deploy executa automaticamente:
  - `ensure` e `backup` antes de trocar o symlink `current`
  - `verify` após iniciar a API
- Logs de auditoria: `shared/uploads_audit.log`

Variáveis opcionais:
- `UPLOADS_ALERT_WEBHOOK_URL`: webhook para alertas (POST JSON) em falhas de verificação
- `UPLOADS_ALERT_EMAIL`: email via `mail` (se instalado)
- `UPLOADS_VERIFY_FULL=true`: valida todas as referências do banco (pode ser mais lento)
- `UPLOADS_VERIFY_MAX=2000`: limite de verificação quando `UPLOADS_VERIFY_FULL=false`

## Base de Municípios (cache local IBGE)

### Objetivo

- Reduzir tráfego e dependência do IBGE durante cadastro/edição (consulta local no banco).
- Permitir funcionamento offline (desde que o banco tenha sido migrado e populado).

### Estrutura no banco

- Tabelas: `public.municipalities` e `public.municipalities_sync_state`
- Migrations: `lib/db/migrations/0006_create_municipalities_cache.sql` e `lib/db/migrations/0007_seed_municipalities.sql`

### Primeira carga (produção)

- Aplicar migrations do banco (inclui o seed com 5.570 municípios).
- Validar integridade do seed local:

```powershell
pnpm run test:municipalities:seed
```

### Atualização periódica

- A API executa sincronização automaticamente quando `municipalities_sync_state.next_due_at` estiver vencido (checagem 1x por dia e também no startup).
- Cadência configurável por variável de ambiente:
  - `MUNICIPALITIES_SYNC_CADENCE=semiannual` (padrão)
  - `MUNICIPALITIES_SYNC_CADENCE=quarterly`
- Para desabilitar: `MUNICIPALITIES_SYNC_ENABLED=false`

### Funcionamento offline

- Rotas e validações de município consultam primeiro `public.municipalities`.
- O fallback para a API do IBGE só ocorre quando o município/UF não existe localmente.

