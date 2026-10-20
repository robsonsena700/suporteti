# Documentação de Integração — Aplicação "Tarefas do Dia"

## ANEXO A — Plano de Coleta e Validação de Dados (Painel de Secrets)

### A.1 Objetivo
Coletar, validar e disponibilizar **7 variáveis de ambiente** necessárias para conectar a aplicação Tarefas do Dia à base compartilhada SuporteTI e ao serviço de e-mail. Os valores são obtidos **apenas das fontes oficiais do projeto existente** (nunca inventados) e validados por testes automatizados antes do uso em produção.

### A.2 Mapeamento Campo → Fonte Oficial
Cada campo do painel de secrets possui **uma única fonte de verdade** no projeto SuporteTI existente.
⚠️ **Diferença crítica identificada:** no servidor VPS de PRODUÇÃO o domínio SMTP é **`.com.br`** (não `.com`). Use sempre os valores abaixo.

| # | Campo no Painel (WebDev Secrets) | Fonte de Origem no Projeto SuporteTI | Valor CONFIRMADO do Servidor VPS | Arquivo de Referência | Responsável |
|---|----------------------------------|--------------------------------------|-----------------------------------|-----------------------|-------------|
| 1 | `SUPORTETI_DATABASE_URL` | Conexão PG do servidor VPS — porta **5446**, usuário `suporte_app` (owner do banco), database `suporteti` | Formato: `postgresql://suporte_app:<SENHA>@<HOST_VPS_PUBLICO>:5446/suporteti?schema=public` | psql shell: `\l` (owner suporteti = suporte_app) | Gestor do Projeto |
| 2 | `SUPORTETI_SESSION_SECRET` | Segredo JWT compartilhado entre apps | Copiar do `.env` do servidor (não gerar novo) | `~/suporte-ti/shared/.env` do VPS | Gestor do Projeto |
| 3 | `SUPORTETI_SMTP_HOST` | `.env` do servidor VPS — produção | `smtp.sotechsaude.com.br` ⚠️ (com .br — não .com) | `~/suporte-ti/shared/.env` (SMTP_HOST) | TI |
| 4 | `SUPORTETI_SMTP_PORT` | `.env` do servidor VPS — produção | `587` | `~/suporte-ti/shared/.env` (SMTP_PORT) | TI |
| 5 | `SUPORTETI_SMTP_USER` | `.env` do servidor VPS — produção | `suporte@sotechsaude.com.br` | `~/suporte-ti/shared/.env` (SMTP_USER) | TI |
| 6 | `SUPORTETI_SMTP_PASS` | `.env` do servidor VPS — produção | Senha real da conta `suporte@sotechsaude.com.br` (não copiada aqui) | `~/suporte-ti/shared/.env` (SMTP_PASS) | TI |
| 7 | `SUPORTETI_SMTP_FROM` | `.env` do servidor VPS — produção | `"Tarefas do Dia <suporte@sotechsaude.com.br>"` | `~/suporte-ti/shared/.env` (SMTP_FROM, adaptar "Nome") | Gestor do Projeto |

### A.3 Critérios de Validação (Por Campo — Nível de Rigor Alto)
Cada valor informado nos campos do painel **deve passar nos testes abaixo** antes de ser armazenado (validação lógica, sem expor credenciais).

| Campo | RegEx / Critério | Comando de Verificação | Resultado Esperado |
|-------|------------------|------------------------|--------------------|
| **`SUPORTETI_DATABASE_URL`** | Começa com `postgresql://` ou `postgres://`, contém `:porta/dbname`. Não contém `localhost` em produção. | `node -e "const u=new URL(process.env.V); console.log(u.protocol==='postgresql:'||u.protocol==='postgres:?'OK-formato-inválido')"` | `OK` |
| **`SUPORTETI_SESSION_SECRET`** | Mín. 16 bytes (recomendado 32+). Não usar `change-me` ou defaults fracos. | `node -e "const s=process.env.V; console.log(s.length>=16 && s!=='change-me'?'OK':'FRACO')"` | `OK` |
| **`SUPORTETI_SMTP_HOST`** | Hostname DNS válido (possui `.`; não contém espaços; não começa/termina com `-`). | `node -e "const h=process.env.V; console.log(/(?=^.{1,253}$)(^(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$)/.test(h)?'OK':'HOST-inválido')"` | `OK` |
| **`SUPORTETI_SMTP_PORT`** | Inteiro entre `1` e `65535`. Um de: `25, 465, 587, 2525` (portas padrão). | `node -e "const n=+process.env.V; console.log(Number.isInteger(n)&&n>0&&n<65536?'OK':'PORTA-inválida')"` | `OK` |
| **`SUPORTETI_SMTP_USER`** | E-mail válido (RFC 5322 básico) ou username curto (<=64 chars). | `node -e "const u=process.env.V; console.log(u && u.length>=3 && u.length<=64?'OK':'USER-inválido')"` | `OK` |
| **`SUPORTETI_SMTP_PASS`** | Mín. 8 chars. Não é string vazia. Não logar. | `node -e "const p=process.env.V||''; console.log(p.length>=8?'OK':'SENHA-fraca')"` | `OK` |
| **`SUPORTETI_SMTP_FROM`** | Formato `"Nome <email@dominio.com>"` ou apenas `email@dominio.com`. | `node -e "const f=process.env.V||''; console.log(/.+@.+\..+/.test(f)?'OK':'FROM-inválido')"` | `OK` |

### A.4 Verificação de Funcionamento (Testes Fumaca — Após Preencher)
Depois de clicar **Salvar** no painel, executar estes testes para **confirmar veracidade** dos dados:

| Teste | Como Fazer | Critério de Aprovação | Prazo |
|-------|-----------|------------------------|-------|
| **T1. Conexão PostgreSQL** | Rodar `SELECT 1;` e `SELECT count(*) FROM users;` usando `SUPORTETI_DATABASE_URL` | Conecta; retorna contagem ≥ 0 de usuários | D+0 (imediatamente após salvar) |
| **T2. Round-trip JWT** | `jwt.sign(payload, SECRET)` e depois `jwt.verify()`, usando `SUPORTETI_SESSION_SECRET` | Verifica sem erro `JsonWebTokenError` | D+0 |
| **T3. SMTP Handshake** | `nodemailer.createTransport({host,port,auth:{user,pass}}).verify()` | Promise resolve `true` (EHLO + AUTH OK) | D+0 |
| **T4. E-mail Envio (Opcional)** | Enviar um e-mail teste para uma caixa controlada | Chega na caixa de entrada (não spam) em ≤ 2 min | D+0 |
| **T5. Compatibilidade bcrypt** | Pegar 1 `password_hash` da tabela `users` e testar `bcrypt.compare('senha_qualquer', hash)` | Não lança exceção (mesmo que retorne falso — valida que é bcrypt) | D+0 |

### A.5 Formato de Apresentação dos Resultados

**A.5.1 Painel WebDev (Input)** — Cada campo recebe **apenas o valor bruto**, sem aspas extras, sem `VAR=` no início:
```
SUPORTETI_DATABASE_URL = postgresql://user:pass@host:5432/dbname?schema=public     ← assim (correto)
SUPORTETI_DATABASE_URL = "postgresql://..."                                       ← assim NÃO (não use aspas)
SUPORTETI_DATABASE_URL = DATABASE_URL=postgresql://...                             ← assim NÃO (não repita VAR=)
```

**A.5.2 Relatório de Verificação (Output)** — Gerar relatório em JSON/MARkDOWN no formato:
```
┌───────────────────────────────┐
│ RELATÓRIO DE VALIDAÇÃO — D+0  │
├───────────────────────────────┤
│ T1 Conexão PG:       ✅ PASS   │
│ T2 JWT round-trip:   ✅ PASS   │
│ T3 SMTP handshake:  ✅ PASS   │
│ T4 E-mail envio:    ⏭️ SKIP   │
│ T5 bcrypt compat:   ✅ PASS   │
├───────────────────────────────┤
│ STATUS GERAL:     APROVADO ✅  │
└───────────────────────────────┘
```

### A.6 Prazos de Entrega (Cronograma)

| Etapa | Descrição | Prazo | Entregável |
|-------|-----------|-------|------------|
| **E1. Coleta** | Preenchimento dos 7 campos no painel de secrets WebDev | **D+0 — hoje** | Painel salvo |
| **E2. Validação formato** | Rodar critérios §A.3 em cada campo | **D+0 — até 2h após E1** | Ajustes (se houver) |
| **E3. Testes fumaça** | Executar T1–T5 do §A.4 | **D+0 — até 4h após E1** | Relatório A.5.2 aprovado |
| **E4. Implementação Auth** | Backend: login/register/forgot/reset + middleware | **D+1** | Rotas funcionando + testes unitários |
| **E5. CRUD Tarefas** | Tabela + endpoints + RLS por usuário | **D+2** | API completa |
| **E6. Telas UI** | Login/cadastro/recuperação/dashboard | **D+3** | App navegável |
| **E7. UAT** | Testes de aceite com usuário piloto | **D+4** | Assinatura de aprovação |
| **E8. Go-live** | Deploy em produção | **D+5** | Aplicação no ar |

### A.7 Estrutura de Governança & Responsabilidades

| Papel | Responsabilidade |
|-------|------------------|
| **Gestor do Projeto** | Preencher `SUPORTETI_DATABASE_URL`, `SUPORTETI_SESSION_SECRET`, `SUPORTETI_SMTP_FROM`. Validar D+0. |
| **TI / Infra** | Preencher `SUPORTETI_SMTP_HOST`, `SUPORTETI_SMTP_PORT`, `SUPORTETI_SMTP_USER`, `SUPORTETI_SMTP_PASS`. Validar SMTP (T3, T4). |
| **Desenvolvedor** | Executar testes fumaça T1, T2, T5. Gerar relatório A.5.2. Sinalizar bloqueios. |
| **Aprovador (Robson)** | Assinar relatório final antes de E8 (Go-live). |

### A.8 Checklist de Conformidade (Para Aprovação Final)
- [ ] Todos os 7 campos preenchidos no painel WebDev
- [ ] Nenhuma credencial enviada no chat (apenas por secrets)
- [ ] `SUPORTETI_SMTP_HOST` é **`smtp.sotechsaude.com.br`** (com `.br` — não `.com`)
- [ ] `SUPORTETI_DATABASE_URL` usa **porta 5446** e usuário **`suporte_app`** (não `postgres`) e NÃO contém `localhost` em produção
- [ ] `SUPORTETI_SESSION_SECRET` tem ≥ 32 bytes de entropia e é o **mesmo** do app SuporteTI (novo segredo = quebra SSO)
- [ ] `SUPORTETI_SMTP_FROM` usa a caixa `@sotechsaude.com.br`
- [ ] SMTP handshake `verify()` retorna `true`
- [ ] Conexão PG retorna contagem de usuários ≥ 1
- [ ] JWT gerado com segredo do painel verifica sem erros
- [ ] Relatório A.5.2 emitido e armazenado

---

## ANEXO B — Guia Campo-a-Campo do Painel WebDev (Passo a Passo)

### B.1 Visão Geral
O painel WebDev pede **7 campos de secrets**. Esta seção diz **exatamente o que colar em cada input**.
⚠️ **Regra de ouro:** Copiar/colar do `.env` real do servidor `~/suporte-ti/shared/.env`. **Não inventar valores**, não digitar manualmente.

### B.2 Preenchimento Exato Campo-por-Campo
Abra o painel de secrets e preencha **exatamente** como indicado abaixo:

| # | Campo do Painel | ⚙️ O que Colar | Status |
|---|----------------|----------------|--------|
| **1** | **`SUPORTETI_DATABASE_URL`** | Copie do servidor VPS — formato obrigatório:<br>`postgresql://suporte_app:SENHA_REAL@IP_OU_HOSTNAME_VPS:5446/suporteti?schema=public`<br><br>⚠️ Obrigatório: `porta 5446`, usuário `suporte_app` (não postgres), dbname `suporteti`, final `?schema=public`. | 🔐 **Sensível** — preencher |
| **2** | **`SUPORTETI_SESSION_SECRET`** | Copie **exatamente o mesmo valor** da chave `SESSION_SECRET` que está no `.env` do SuporteTI no VPS.<br>NÃO gere um novo valor (senão SSO entre apps quebra). | 🔐 **Sensível** — preencher |
| **3** | **`SUPORTETI_SMTP_HOST`** | Cole **exatamente:**<br>```smtp.sotechsaude.com.br```<br>⚠️ **ATENÇÃO:** é `.com.br` no final. Qualquer coisa diferente → falha de envio. | ✅ Confirmado — valor acima |
| **4** | **`SUPORTETI_SMTP_PORT`** | Cole **exatamente:**<br>```587``` | ✅ Confirmado (já estava no painel) |
| **5** | **`SUPORTETI_SMTP_USER`** | Cole **exatamente:**<br>```suporte@sotechsaude.com.br``` | ✅ Confirmado — valor acima |
| **6** | **`SUPORTETI_SMTP_PASS`** | Copie a **senha real** da conta `suporte@sotechsaude.com.br` do `.env` do VPS.<br>É a senha que aparece como `***` no `cat .env` do shell. | 🔐 **Sensível** — preencher |
| **7** | **`SUPORTETI_SMTP_FROM`** | Cole **exatamente** (com aspas duplas):<br>```"Tarefas do Dia <suporte@sotechsaude.com.br>"```<br>Obs: pode trocar o nome "Tarefas do Dia" por outro de sua preferência; mantenha o e-mail intacto. | ✅ Confirmado — modelo acima |

### B.3 Screenshot do Preenchimento Esperado
```
┌─ Painel de Secrets WebDev ───────────────────────────────────────────┐
│ SUPORTETI_DATABASE_URL       │ postgresql://suporte_app:•••@ip:5446… │ ✅
│ SUPORTETI_SESSION_SECRET     │ •••••••••••••••••••••••••••••••••    │ ✅
│ SUPORTETI_SMTP_HOST          │ smtp.sotechsaude.com.br              │ ✅
│ SUPORTETI_SMTP_PORT          │ 587                                  │ ✅
│ SUPORTETI_SMTP_USER          │ suporte@sotechsaude.com.br           │ ✅
│ SUPORTETI_SMTP_PASS          │ ••••••••••••••••••••                 │ ✅
│ SUPORTETI_SMTP_FROM          │ "Tarefas do Dia <suporte@…com.br>"   │ ✅
└──────────────────────────────┴──────────────────────────────────────┘
                               [Cancelar]    [Salvar]
```

### B.4 Erros Comuns a Evitar
| Erro | Correção |
|------|----------|
| `smtp.sotechsaude.com` (sem `.br`) | Adicionar `.br` no final → `smtp.sotechsaude.com.br` |
| Usuário `postgres` no DATABASE_URL | Trocar por `suporte_app` (owner real do banco) |
| Porta errada no DATABASE_URL (ex: 5432, 5555, 5445) | Trocar porta para **5446** |
| Gerar novo `SESSION_SECRET` aleatório | **NÃO fazer.** Usar EXATAMENTE o mesmo do SuporteTI para SSO funcionar |
| Colocar `DATABASE_URL=` como prefixo do valor | Colar **só** a URL, sem o `VAR=` |
| Aspas `"` ou `'` em volta da URL de conexão | Colar valor **sem aspas** (apenas FROM pode ter aspas duplas por causa do "Nome <email>") |

### B.5 Próximo Passo Imediatamente Após Salvar
Depois de clicar no botão **[Salvar]** do painel:
```bash
# 1. Instalar dependências do script de validação
cd "C:\Users\Robson Sena\Documents\SuporteTI\Suporte-Ti"
pnpm add -D pg jsonwebtoken nodemailer bcryptjs

# 2. Exportar as 7 variáveis (substituir pelos valores do painel)
$env:SUPORTETI_DATABASE_URL="postgresql://suporte_app:***@HOST:5446/suporteti?schema=public"
$env:SUPORTETI_SESSION_SECRET="***"
$env:SUPORTETI_SMTP_HOST="smtp.sotechsaude.com.br"
$env:SUPORTETI_SMTP_PORT="587"
$env:SUPORTETI_SMTP_USER="suporte@sotechsaude.com.br"
$env:SUPORTETI_SMTP_PASS="***"
$env:SUPORTETI_SMTP_FROM="`"Tarefas do Dia <suporte@sotechsaude.com.br>`""

# 3. Rodar script de validação completo
node .\scripts\validar-secrets-tarefas-do-dia.mjs
```
Saída esperada: **STATUS GERAL: APROVADO ✅** (todos os testes PASS)

---

## 1. Situação Atual da Base Compartilhada (Confirmada no Código)

### 1.1 Stack de Dados
- **SGBD Atual:** PostgreSQL (drizzle-orm/pg-core)
- **Dialeto Drizzle:** `postgresql` (definido em `lib/db/drizzle.config.ts`)
- **Conexão:** `DATABASE_URL` via variável de ambiente
- **Aplicação proprietária da base:** SuporteTI

### 1.2 Autenticação Já Implementada (Reaproveitável)
| Item | Implementação Atual |
|------|---------------------|
| **Método de login** | E-mail + senha |
| **Hash de senha** | `bcryptjs` — salt rounds = 10 |
| **Sessão/Token** | JWT HS256 via `SESSION_SECRET` — expiração 7 dias |
| **Payload JWT** | `userId`, `email`, `role`, `status`, `uf`, `municipality` |
| **Recuperação de senha** | Token hash + e-mail (1h expiração) |
| **Política de senha** | Validação de força + histórico (últimas 2 senhas) |
| **Auditoria de segurança** | Tabela `security_audit_logs` |
| **OAuth Manus/Google** | NÃO implementado no código atual |

### 1.3 Papéis (Roles) Existentes
```
user_role ENUM: USER | COORDINATOR | ANALYST | ADMIN | GESTOR
```

### 1.4 Status de Usuário
```
user_status ENUM: PENDING | ACTIVE | INACTIVE
```

---

## 2. Estrutura da Tabela `users` (Dicionário de Dados)

**Tabela:** `public.users`

| Coluna | Tipo PG | Constraints | Descrição |
|--------|---------|-------------|-----------|
| `id` | serial | PK | Identificador único (integer auto-increment) |
| `name` | text | NOT NULL | Nome completo do usuário |
| `email` | text | NOT NULL, UNIQUE | E-mail de login (normalizar lowercase) |
| `password_hash` | text | NOT NULL | Hash bcrypt da senha |
| `must_change_password` | boolean | NOT NULL, DEFAULT false | Força troca no próximo login |
| `role` | user_role ENUM | NOT NULL, DEFAULT 'USER' | Perfil de acesso |
| `status` | user_status ENUM | NOT NULL, DEFAULT 'PENDING' | Situação da conta |
| `cpf` | text | UNIQUE, NULLABLE | CPF normalizado (11 dígitos) |
| `establishment` | text | NULLABLE | Estabelecimento/Unidade |
| `contact_phone` | text | NULLABLE | Telefone em formato E.164 Brasil |
| `prefers_whatsapp` | boolean | NOT NULL, DEFAULT false | Preferência de contato |
| `prefers_telegram` | boolean | NOT NULL, DEFAULT false | Preferência de contato |
| `terms_accepted` | boolean | NOT NULL, DEFAULT false | Aceite de termos |
| `terms_accepted_at` | timestamptz | NULLABLE | Data do aceite |
| `birth_date` | date | NULLABLE | Data de nascimento |
| `uf` | text | NOT NULL | UF de residência/lotação |
| `municipality` | text | NOT NULL | Município |
| `avatar_mime_type` | text | NULLABLE | MIME do avatar |
| `avatar_data` | text | NULLABLE | Base64 do avatar |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | Dt. criação |
| `last_login_at` | timestamptz | NULLABLE | Último login |
| `updated_at` | timestamptz | NOT NULL, DEFAULT now() | Dt. atualização |

**Indexes/Constraints nativos:**
- PK em `id`
- UNIQUE em `email`
- UNIQUE em `cpf`
- FKs apontando para `users.id` em 14+ tabelas (não remover/alterar users.id)

---

## 3. Tabelas Complementares de Autenticação & Segurança

### 3.1 `password_reset_tokens`
| Coluna | Tipo | Uso |
|--------|------|-----|
| `id` | serial PK | |
| `user_id` | integer FK → users | |
| `token_hash` | text | Hash SHA-256 do token one-time |
| `purpose` | text | `forgot_password` \| `admin_reset` |
| `requested_by_user_id` | integer FK → users (NULL) | Quem solicitou (admin) |
| `requested_ip` / `requested_user_agent` | text | Auditoria |
| `expires_at` / `used_at` | timestamptz | Controle de vigência |
| `used_ip` / `used_user_agent` | text | Auditoria de uso |

### 3.2 `user_password_history`
| Coluna | Tipo | Uso |
|--------|------|-----|
| `id` | serial PK | |
| `user_id` | integer FK → users (CASCADE) | |
| `password_hash` | text | Hash anterior (mantém últimas 2) |
| `created_at` | timestamptz | |

### 3.3 `security_audit_logs`
| Coluna | Tipo |
|--------|------|
| `id`, `event_type`, `actor_user_id`, `target_user_id`, `target_email`, `ip`, `user_agent`, `detail`, `created_at` |

---

## 4. Middleware de Autenticação (API Server SuporteTI)

**Local:** `artifacts/api-server/src/middlewares/auth.ts`

```typescript
// Funções disponíveis (copiar/reutilizar):
signToken(payload: JwtPayload): string        // gera JWT 7 dias
verifyToken(token: string): JwtPayload        // valida JWT
requireAuth()                                  // middleware 401 sem Bearer
requireRoles(...roles)                         // middleware 403
requireActive()                                // middleware conta ACTIVE
```

**JWT Payload Type:**
```typescript
{
  userId: number;
  email: string;
  role: "USER"|"COORDINATOR"|"ANALYST"|"ADMIN"|"GESTOR";
  status: "PENDING"|"ACTIVE"|"INACTIVE";
  uf: string;
  municipality: string;
}
```

---

## 5. Cenários de Integração Para "Tarefas do Dia"

### Opção A — Compartilhar MESMA Base (Recomendado)
- App Tarefas do Dia conecta-se no **mesmo DATABASE_URL** do SuporteTI
- Lê/valida credenciais diretamente em `public.users` (bcrypt compare)
- Gera JWT próprio com `SESSION_SECRET` COMPARTILHADO ou SECRETO PRÓPRIO
- **Vantagens:** usuários existentes logam de imediato; sem sincronização
- **Riscos:** escrita concorrente na tabela users; FKs não quebram

### Opção B — Base Separada + Sincronização
- App Tarefas do Dia tem seu próprio PostgreSQL
- Sincroniza usuários por API ou webhook (não recomendado para login)

### Opção C — SSO via API do SuporteTI
- App Tarefas do Dia chama `POST /auth/login` do SuporteTI e recebe JWT
- Não toca no banco diretamente
- **Vantagens:** desacoplamento total; respeita middleware existente

---

## 6. Escopo Mínimo para Tarefas do Dia (MVP)

### 6.1 Telas Reutilizáveis (copiar padrão de `artifacts/suporte-ti/src/pages/`)
- `login.tsx` — E-mail + senha
- `register.tsx` — Cadastro completo (cpf, telefone, município, termos)
- `forgot-password.tsx` — Solicita e-mail
- `reset-password.tsx` — Define nova senha via token

### 6.2 Endpoints Mínimos a Implementar
| Método | Rota | Reuso |
|--------|------|-------|
| POST | `/auth/register` | bcrypt.hash(10), valida CPF/IBGE/telefone |
| POST | `/auth/login` | bcrypt.compare + signToken |
| POST | `/auth/logout` | (stateless JWT: limpar storage cliente) |
| GET | `/auth/me` | requireAuth → SELECT users |
| POST | `/auth/change-password` | requireAuth + bcrypt + histórico |
| POST | `/auth/forgot-password` | token hash + e-mail |
| POST | `/auth/reset-password/validate` | valida vigência token |
| POST | `/auth/reset-password` | efetiva troca + auditoria |

### 6.3 CRUD Tarefas (Protegido Por Usuário)
Nova tabela (exemplo):
```sql
CREATE TABLE tarefas_do_dia (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descricao TEXT,
  data DATE NOT NULL,
  concluido BOOLEAN NOT NULL DEFAULT FALSE,
  prioridade TEXT CHECK (prioridade IN ('BAIXA','MEDIA','ALTA')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tarefas_user_data ON tarefas_do_dia(user_id, data);
```

**Regra Row-Level:** Todo SELECT/UPDATE/DELETE deve incluir `WHERE user_id = current_user_id_do_jwt`.

---

## 7. Itens a Confirmar (Bloqueantes)

| # | Pergunta | Opções |
|---|----------|--------|
| 1 | Login será **e-mail + senha** (padrão atual)? | (a) Sim, exatamente como SuporteTI / (b) Quero adicionar OAuth também |
| 2 | Manter login Manus/Google? | (a) Não existe hoje, não preciso / (b) Quero implementar |
| 3 | Compartilha **mesmo banco PostgreSQL** do SuporteTI? | (a) Sim / (b) Não — banco separado |
| 4 | **SESSION_SECRET** do JWT será compartilhado ou a app terá o próprio? | (a) Mesmo segredo (SSO transparente) / (b) Segredo próprio |
| 5 | PostgreSQL está hospedado onde? | (a) Supabase / (b) Neon / (c) Railway / (d) Render / (e) VPS próprio (f) Outro |
| 6 | Novos cadastros fluem para o SuporteTI também? | (a) Sim, mesma tabela users / (b) Não, Tarefas terá users própria |
| 7 | Papéis (roles): usar o mesmo ENUM ou criar perfis específicos? | (a) Mesmos / (b) Novos perfis para Tarefas |

---

## 8. Resumo das Confirmações (Respondidas)

| # | Item | Resposta |
|---|------|----------|
| 1 | Método de login | **E-mail + senha** (mesmo bcrypt do SuporteTI) |
| 2 | OAuth Manus/Google | **Não implementar** |
| 3 | Banco de dados | **MESMO PostgreSQL compartilhado** com SuporteTI |
| 4 | SESSION_SECRET JWT | **Mesmo segredo** (SSO transparente entre apps) |
| 5 | Hospedagem PG | **VPS/servidor próprio** — URL e segredo já existem em `.env` da workspace |
| 6 | Novos cadastros | **Mesma tabela `users`** — cadastros no Tarefas aparecem no SuporteTI |
| 7 | Papéis/roles | **Mesmos ENUM** (`USER \| COORDINATOR \| ANALYST \| ADMIN \| GESTOR`) |

---

## 9. Orientações de Conexão (Ambiente Atual)

### 9.1 Variáveis Reutilizáveis (Copiar do .env da workspace)

A conexão de banco e o segredo JWT já existem em `C:\Users\Robson Sena\Documents\SuporteTI\Suporte-Ti\.env`.
**Copie estas 5 variáveis para o `.env` da aplicação Tarefas do Dia** — use os VALORES EXISTENTES, NÃO gerar novos.

```dotenv
# ── Conexão PostgreSQL (compartilhada com SuporteTI) ──
DATABASE_URL=postgresql://<user>:<password>@<host>:<porta>/suporteti?schema=public

# ── JWT (MESMO segredo = SSO transparente) ──
SESSION_SECRET=<copiar-valor-existente>

# ── Portas e URLs da NOVA aplicação Tarefas do Dia ──
API_PORT=<nova-porta-ex: 3282>         # NÃO usar 3281 (é do SuporteTI)
WEB_PORT=<nova-porta-ex: 5112>         # NÃO usar 5111 (é do SuporteTI)
APP_PUBLIC_URL=http://localhost:5112/  # URL pública do Tarefas do Dia

# ── SMTP (envio recuperação de senha) ──
MAIL_MODE=smtp
SMTP_HOST=<copiar-se-existente-ou-configurar>
SMTP_PORT=587
SMTP_USER=<usuario>
SMTP_PASS=<senha>
SMTP_FROM="Tarefas do Dia <nao-responda@seu-dominio.com>"
```

> **IMPORTANTE SSO:** Como `SESSION_SECRET` é o mesmo, um token JWT emitido pelo SuporteTI é válido no Tarefas do Dia e vice-versa. Usuário loga uma única vez.

### 9.2 Inicializar Drizzle + Pool na Nova Aplicação

Copiar padrão de `lib/db/src/index.ts`:

```typescript
// src/db/index.ts  (na aplicação Tarefas do Dia)
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

// Reutilizar os MESMOS schemas de users, password_reset_tokens etc
// OU importar diretamente de @workspace/db se for workspace pnpm
import * as sharedSchema from "./shared-schema";
import * as tarefasSchema from "./tarefas-schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não definido");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,                  // não exceder max_connections do PG
  statement_timeout: 30000, // 30s timeout por query
});

const schema = { ...sharedSchema, ...tarefasSchema };
export const db = drizzle(pool, { schema });
```

### 9.3 Reutilizar bcrypt e JWT (Bibliotecas)

No `package.json` da nova app, incluir:
```json
"dependencies": {
  "bcryptjs": "^2.4.3",
  "jsonwebtoken": "^9.0.0",
  "pg": "^8.11.0",
  "drizzle-orm": "^0.33.0",
  "zod": "^3.23.0"
}
```

### 9.4 Fluxo Login Compartilhado (Exemplo)

```typescript
// src/routes/auth/login.ts
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, usersTable } from "../db";
import { eq } from "drizzle-orm";

// MESMO algoritmo do SuporteTI: bcrypt 10 rounds
const valid = await bcrypt.compare(password, user.password_hash);
if (!valid) return res.status(401).json({ error: "Credenciais inválidas" });

// MESMO payload + MESMO segredo = SSO
const token = jwt.sign(
  {
    userId: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    uf: user.uf,
    municipality: user.municipality,
  },
  process.env.SESSION_SECRET!,
  { expiresIn: "7d" }  // MESMA expiração
);
```

### 9.5 Regras NÃO Quebrar (Tabela users Compartilhada)

| Regra | Motivo |
|-------|--------|
| NÃO alterar tipo de `users.id` (serial/integer) | 14+ tabelas têm FK apontando para esse ID |
| NÃO remover colunas existentes | App SuporteTI depende de todas |
| NÃO tornar NOT NULL colunas que hoje são NULLABLE | Dados existentes podem ser NULL |
| Ao inserir, sempre preencher `uf` e `municipality` | São NOT NULL na tabela |
| `cpf` deve ser normalizado (11 dígitos, só números) | UNIQUE index — duplicidade causa erro |
| `email` salvar sempre lowercase | UNIQUE index case-sensitive no PG |
| Usar `bcryptjs` rounds = 10 | Hash diferente = senha não valida no app irmão |
| Sempre usar **transações** ao escrever em `users` + `password_reset_tokens` + `security_audit_logs` | Consistência ACID |
| Respeitar `status = PENDING` até aprovação | Login é bloqueado pelo middleware |

### 9.6 Teste Rápido de Conectividade

Antes de desenvolver, validar na nova aplicação:
```typescript
try {
  const res = await db.execute(sql`SELECT current_database(), version()`);
  const [usersCount] = await db.select({ count: sql<number>`count(*)` }).from(usersTable);
  console.log("✅ Conectado. Total de usuários existentes:", usersCount.count);
} catch (e) {
  console.error("❌ Falha conexão:", e);
}
```

---

## 10. Credenciais — Segurança

- Copiar valores do `.env` raiz **apenas localmente**; nunca commitar.
- Em produção: usar secrets manager da hospedagem (não arquivos .env).
- `DATABASE_URL` e `SESSION_SECRET` = dados sensíveis nível 1.

---

## 11. Especificação Final — MVP Tarefas do Dia (Tudo Confirmado)

### 11.1 Decisões Arquiteturais Fechadas
```
┌─ Banco:         PostgreSQL compartilhado (suporteti / public.users)
├─ Autenticação:  E-mail + senha (bcrypt rounds=10)
├─ Token:         JWT HS256 / SESSION_SECRET compartilhado / 7 dias
├─ SSO:           Sim (mesmo token = logado nas 2 apps)
├─ Cadastros:     users comum (cria no Tarefas → visível no SuporteTI)
└─ Papéis:        Mesmo ENUM user_role (USER/COORDINATOR/ANALYST/ADMIN/GESTOR)
```

### 11.2 Checklist de Implementação (Ordem Sugerida)

| Fase | Item | Arquivo/Dependência |
|------|------|---------------------|
| **1. Infra** | Copiar `.env` com `DATABASE_URL`, `SESSION_SECRET`, `API_PORT`, `WEB_PORT`, `APP_PUBLIC_URL`, SMTP | `.env` do Tarefas |
| **1. Infra** | Inicializar `db/pool` Drizzle com `pg` | `src/db/index.ts` |
| **1. Infra** | Instalar: `pg`, `drizzle-orm`, `bcryptjs`, `jsonwebtoken`, `express`, `zod`, `nodemailer` | `package.json` |
| **2. Auth** | Schemas: reutilizar `users`, `password_reset_tokens`, `security_audit_logs`, `user_password_history` | `src/db/shared-schema.ts` |
| **2. Auth** | Middlewares: `requireAuth`, `requireActive`, `requireRoles(idem SuporteTI)` | `src/middlewares/auth.ts` |
| **2. Auth** | POST `/auth/login` — bcrypt compare + signToken (7d) | `src/routes/auth/login.ts` |
| **2. Auth** | POST `/auth/register` — bcrypt hash(10) + valida CPF/IBGE/telefone + status=PENDING | `src/routes/auth/register.ts` |
| **2. Auth** | GET `/auth/me` | `src/routes/auth/me.ts` |
| **2. Auth** | POST `/auth/change-password` | `src/routes/auth/change-password.ts` |
| **2. Auth** | POST `/auth/forgot-password` + `/reset-password/validate` + `/reset-password` | `src/routes/auth/*` |
| **3. Dados Tarefas** | Criar tabela `tarefas_do_dia` via migration Drizzle (ver §6.3 da doc) | `drizzle.config.ts` + `src/schema/tarefas.ts` |
| **3. Dados Tarefas** | Índice obrigatório: `(user_id, data)` | migration SQL |
| **4. CRUD Tarefas** | GET `/tarefas?data=YYYY-MM-DD` → WHERE `user_id = jwt.userId` | `src/routes/tarefas/list.ts` |
| **4. CRUD Tarefas** | POST `/tarefas` → user_id do JWT (NUNCA do body) | `src/routes/tarefas/create.ts` |
| **4. CRUD Tarefas** | PATCH `/tarefas/:id` → WHERE `id=? AND user_id=jwt.userId` | `src/routes/tarefas/update.ts` |
| **4. CRUD Tarefas** | DELETE `/tarefas/:id` → WHERE `id=? AND user_id=jwt.userId` | `src/routes/tarefas/delete.ts` |
| **5. UI** | Telas: `login`, `register`, `forgot-password`, `reset-password`, `dashboard-tarefas` | `src/pages/*` |

### 11.3 Validações Obrigatórias no Register (porque tabela é compartilhada)

Copiar **exatamente** estas validações do SuporteTI (`artifacts/api-server/src/routes/auth.ts`):
- `isValidCpf()` + `normalizeCpf()` → UNIQUE `cpf`
- `isValidBrazilMobile()` + `normalizePhoneE164Brazil()`
- `validateMunicipalityForUf(uf, municipality)` → IBGE consulta
- `birthDate` faixa `1900-01-01 ≤ data ≤ hoje`
- `termsAccepted === true` obrigatório
- `email` lowercased antes de SELECT/INSERT
- **Hash:** `bcrypt.hash(password, 10)` (não 12 nem 8 — tem que ser 10)

### 11.4 Row-Level Security (Tarefas)
**Nenhuma rota de tarefa deve receber `user_id` pelo body/query.**
Sempre extrair do JWT:
```typescript
const userId = req.user!.userId;
await db.select().from(tarefasTable)
  .where(and(eq(tarefasTable.userId, userId), ...filtros));
```

---