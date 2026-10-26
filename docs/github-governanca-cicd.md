# Governanca GitHub, Branches e CI/CD

## 1. Diagnostico atual

- A branch `main` remota esta atras da linha mais recente de release.
- A linha mais avancada hoje esta em `origin/V3.0.4`, com correcos de seguranca, deploy e funcionalidades posteriores a `main`.
- O repositório nao possui workflows versionados em `.github/workflows/`.
- O deploy atual depende de scripts locais em PowerShell, principalmente `scripts/prepare_deploy.ps1`, `scripts/create_pr.ps1` e `scripts/deploy_prod.ps1`.
- A documentacao de deploy ainda citava `develop`, enquanto a estrategia desejada para o time passa a ser `Development`.

## 2. Estrutura recomendada de branches

### Branches principais

- `main`: codigo validado para producao.
- `Development`: integracao homologada da equipe.

### Branches de trabalho individuais

- `feature/<nome-da-feature>`
- `fix/<nome-do-ajuste>`
- `hotfix/<nome-do-incidente>`
- `chore/<tema>`

### Fluxo padrao

1. Cada desenvolvedor cria sua branch a partir de `Development`.
2. O desenvolvedor abre PR para `Development`.
3. O CI valida typecheck, build e testes unitarios.
4. Apos revisao e aprovacao, o PR entra em `Development`.
5. Quando `Development` estiver homologada, abre-se PR para `main`.
6. A producao so pode ser publicada a partir de `main`, via workflow manual protegido por environment.

## 3. Regras de integracao

- Ninguem faz push direto em `main`.
- Ninguem faz push direto em `Development`, exceto automacoes explicitamente autorizadas.
- Todo PR para `Development` e `main` exige revisao.
- Os checks obrigatorios devem incluir o job `quality` do workflow de CI.
- Commits devem ser pequenos, tematicos e com mensagem objetiva.
- Mudanca de schema ou segredo precisa estar descrita no PR sem expor credenciais.

## 4. Workflows adicionados

### CI de integracao

Arquivo: `.github/workflows/ci.yml`

- Dispara em PR para `Development` e `main`.
- Dispara em push para `Development`.
- Executa:
  - `pnpm install --frozen-lockfile`
  - `pnpm run typecheck`
  - `pnpm run build`
  - bateria de testes unitarios do workspace

### Auditoria de dependencias

Arquivo: `.github/workflows/security-audit.yml`

- Dispara manualmente e semanalmente.
- Executa `pnpm audit --prod`.

### Release manual da `main`

Arquivo: `.github/workflows/release-main.yml`

- Disparo manual (`workflow_dispatch`) apenas na `main`.
- Sempre valida `typecheck` e `build`.
- So executa deploy quando o input `run_deploy` estiver ativo.
- Usa `environment: production`, para encaixar aprovacao manual e secrets protegidos.

## 5. Protecoes de branch

As protecoes do GitHub nao ficam armazenadas automaticamente no repositorio. Para aplicar no remoto:

1. Garantir token com permissao administrativa no repositorio.
2. Executar `scripts/configure_github_branch_protection.ps1`.

### Politica recomendada

#### `Development`

- Require a pull request before merging
- 1 aprovacao minima
- Dismiss stale reviews
- Require conversation resolution
- Require status checks: `quality`
- Block force push
- Block branch deletion

#### `main`

- Todas as regras de `Development`
- CODEOWNERS obrigatorio
- Merge somente a partir de PR vindo de `Development`
- Deploy somente por workflow manual ou processo formal aprovado

## 6. Secrets e ambientes

### CI / validacao

- Nao precisa de secrets para typecheck/build/testes unitarios.

### Producao

O workflow `release-main.yml` espera estes secrets:

- `PROD_SSH_KEY`
- `PROD_HOST`
- `PROD_PORT`
- `PROD_USER`
- `PROD_REMOTE_BASE_DIR`

Esses valores devem ser cadastrados no environment `production`, nao em variaveis abertas do repositório.

## 7. Atualizacao segura da `main`

Antes de atualizar `main`, validar:

1. Confirmar qual branch representa a versao homologada mais recente.
2. Rodar o CI nessa branch.
3. Abrir PR de homologacao para `main`.
4. Publicar somente apos aprovacao.

### Situacao encontrada nesta analise

- `origin/main` esta atras de `origin/V3.0.4`.
- `origin/V3.0.4` concentra a linha mais recente de release conhecida.
- A branch local `V3.0.4` ainda possui commits locais a mais, entao ela nao deve ser promovida para `main` sem revisao adicional.

## 8. Passo a passo operacional recomendado

### A. Atualizar `main`

1. Validar `origin/V3.0.4` no CI.
2. Abrir PR `origin/V3.0.4 -> main`.
3. Revisar diff e aprovar.
4. Fazer merge em `main`.

### B. Criar `Development`

1. Criar `Development` a partir da `main` ja atualizada.
2. Publicar `Development` no remoto.
3. Configurar branch protection.

### C. Fluxo dos devs

1. `git checkout Development`
2. `git pull origin Development`
3. `git checkout -b feature/minha-entrega`
4. Trabalhar e abrir PR para `Development`

## 9. Pendencias que dependem de autorizacao ou acesso

- Atualizar efetivamente a branch `main` no remoto
- Criar e publicar a branch `Development` no GitHub
- Aplicar branch protection no remoto
- Cadastrar secrets e environment `production`
- Habilitar approvals e restricoes de merge no repositório

## 10. Observacoes de validacao desta analise

- O workspace local estava limpo no momento da inspecao.
- O comando `git fetch --all --prune` nao concluiu integralmente por falha de resolucao do remoto `gitsafe-backup`, mas o fetch de `origin` respondeu.
- `pnpm run typecheck` e `pnpm run build` falharam localmente por erro de permissao em `lib/api-spec/node_modules/jiti/package.json`, indicando necessidade de limpeza/reinstalacao do ambiente local antes da homologacao final.

## 11. Alteracoes realizadas nesta organizacao

- Criacao de `CODEOWNERS`
- Criacao do template padrao de Pull Request
- Criacao do workflow de CI para `Development` e PRs
- Criacao do workflow de auditoria de dependencias
- Criacao do workflow manual de release/deploy da `main`
- Criacao do script para aplicar branch protection via API do GitHub
- Ajuste do script `prepare_deploy.ps1` para priorizar `Development`
- Ajuste da documentacao de deploy para refletir `Development`

## 12. Validacoes executadas nesta entrega

- `git status --short`
- `git fetch origin --prune`
- `git diff --check`
- parsing PowerShell de `scripts/prepare_deploy.ps1`
- parsing PowerShell de `scripts/configure_github_branch_protection.ps1`
- tentativa de `pnpm run typecheck`
- tentativa de `pnpm run build`
