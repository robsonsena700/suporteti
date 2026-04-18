# Workspace

## Overview

pnpm workspace monorepo usando TypeScript. Sistema de Suporte TI — aplicação full-stack de gerenciamento de chamados com controle de acesso por perfis.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Auth**: JWT (jsonwebtoken + bcryptjs)

## Aplicação: Sistema de Suporte TI

### Funcionalidades
- Autenticação JWT com perfis: USER, COORDINATOR, ANALYST, ADMIN
- Usuários ficam PENDING até aprovação do ADMIN
- Chamados de SOFTWARE e HARDWARE com status, prioridade, UF e município
- Roteamento automático por região (coordenadores veem só sua UF+município)
- Sistema de mensagens em threads por chamado
- Avaliação de chamados resolvidos (1-5 estrelas)
- Relatórios: volume, status, região e tipo
- UI em português do Brasil com modo claro/escuro

### Contas de Exemplo
- Admin: admin@suporte.gov.br / Admin@123
- Analista: carlos@suporte.gov.br / Analista@123
- Coordenador: maria@suporte.gov.br / Coord@123
- Usuário: joao@empresa.gov.br / User@123

## Key Commands

- `pnpm run typecheck` — typecheck completo
- `pnpm run build` — typecheck + build
- `pnpm --filter @workspace/api-spec run codegen` — regenerar hooks React e schemas Zod
- `pnpm --filter @workspace/db run push` — aplicar schema do banco
- `pnpm --filter @workspace/api-server run dev` — rodar API localmente

## Artifacts

- `artifacts/suporte-ti` — Frontend React + Vite (preview path: `/`)
- `artifacts/api-server` — Backend Express (preview path: `/api`)

## Key Files

- `lib/api-spec/openapi.yaml` — Contrato OpenAPI (fonte da verdade)
- `lib/db/src/schema/` — Schema Drizzle do banco de dados
- `artifacts/api-server/src/routes/` — Rotas da API
- `artifacts/api-server/src/middlewares/auth.ts` — JWT middleware
- `artifacts/suporte-ti/src/lib/auth.tsx` — Contexto de autenticação React

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
