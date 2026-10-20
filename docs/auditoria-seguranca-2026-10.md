# Auditoria de Segurança — SuporteTI

**Data:** 20/10/2026
**Escopo:** `artifacts/api-server` (backend), `artifacts/suporte-ti` (frontend), `lib/db` (banco de dados/migrations), scripts de deploy e configuração de ambiente.
**Método:** Revisão de código estática, ponto a ponto, em todas as rotas, middlewares e bibliotecas de segurança do repositório. Não foram feitos testes de invasão ativos (não houve exploração real contra o ambiente de produção) — os achados abaixo são baseados em leitura direta do código-fonte.

## Resumo executivo

A aplicação tem uma base de autenticação e controle de acesso bem construída: senhas com bcrypt, política de senha forte, bloqueio de reuso de senha, tokens de redefinição de senha criptograficamente fortes e de uso único, ORM parametrizado (Drizzle) em 100% das consultas revisadas — não foi encontrado nenhum ponto de SQL Injection — e um módulo de controle de acesso a chamados (`lib/access.ts` / `ticket-access-policy.ts`) com regras de visibilidade bem granulares, que inclusive registra tentativas de acesso negado.

Por outro lado, foram encontrados **2 problemas críticos** que pedem ação imediata e um conjunto de lacunas de "higiene de segurança" (cabeçalhos HTTP, rate limiting, CORS) que são baratas de corrigir e reduzem bastante a superfície de ataque. Nenhuma das rotas de API encontra-se, hoje, sem controle de autenticação — o ponto mais sério não é "alguém acessando dado de outro usuário", e sim exposição de segredos e ausência de proteção contra automação (força bruta) e contra efeitos colaterais de um XSS, caso um apareça no futuro.

## Achados por severidade

| # | Severidade | Camada | Achado |
|---|---|---|---|
| 1 | 🔴 Crítico | Segredos / Git | Arquivo `.env` com credenciais reais está versionado no Git (histórico e atual) |
| 2 | 🔴 Crítico | Backend (Auth) | `SESSION_SECRET` tem fallback para um segredo fixo no código-fonte |
| 3 | 🟠 Alto | Backend (Auth) | Sem rate limiting em login, registro, "esqueci a senha" e validação de token |
| 4 | 🟠 Alto | Backend (Upload) | Anexos de chamado não validam o conteúdo real do arquivo (só confiam no MIME declarado) |
| 5 | 🟠 Alto | Backend (HTTP) | Nenhum cabeçalho de segurança HTTP está configurado (sem helmet/CSP/nosniff) |
| 6 | 🟡 Médio | Frontend | Token de sessão (JWT) fica em `localStorage`, acessível por qualquer script na página |
| 7 | 🟡 Médio | Backend (Auth) | Enumeração de usuários via "esqueci senha" (404) e registro (409 e-mail/CPF já existe) |
| 8 | 🟡 Médio | Backend (CORS) | CORS aberto para qualquer origem (`cors()` sem configuração) |
| 9 | 🟡 Médio | Backend (Auth) | Middlewares de HTTPS/CSRF (`requireHttpsInProduction`, `requireSameOriginInProduction`) existem mas só protegem 1 rota |
| 10 | 🟡 Médio | Backend (Auth) | Token JWT válido por 7 dias, sem revogação — logout não invalida o token no servidor |
| 11 | 🟢 Baixo | Backend (Auth) | Construção do link de redefinição de senha tem fallback (hoje morto) que confiaria em cabeçalhos `Origin`/`Referer` |
| 12 | 🟢 Baixo | Backend (Erros) | Handler de erro expõe uma dica interna de infraestrutura em erros específicos de banco |
| 13 | 🟢 Baixo | Backend (Upload) | `file-sniff.ts` (usado no chat) tem bugs conhecidos de detecção de HEIC/XLS/XLSX |
| 14 | 🟢 Baixo | Infra/Banco | `.env.example` sugere uso do usuário `postgres` (superusuário) em vez de um usuário de aplicação com privilégio restrito |
| 15 | 🟢 Baixo | Infra | Sem auditoria automatizada de dependências (pnpm audit / Dependabot) nos scripts do projeto |

---

## 🔴 1. `.env` com credenciais reais versionado no Git

**Onde:** raiz do repositório — `git ls-files` mostra `.env` rastreado, e o histórico tem commits como `"novas credenciais do .env"`.

**Por que importa:** o `.env` contém `DATABASE_URL` (usuário/senha do Postgres), `SESSION_SECRET` (chave que assina todos os tokens JWT da aplicação) e `SMTP_PASS` (senha de e-mail). Qualquer pessoa com acesso ao repositório Git (hoje ou no futuro, inclusive se o repositório mudar de privado para público por engano, for clonado por um ex-colaborador, ou vazar via um fork) tem acesso total ao banco de dados, consegue forjar tokens de qualquer usuário (inclusive ADMIN) e consegue enviar e-mails pela conta SMTP da aplicação.

**Correção:**
1. Trocar **imediatamente** todas as credenciais expostas: senha do Postgres, `SESSION_SECRET` e senha SMTP. Isso invalida o que já vazou no histórico.
2. Remover o `.env` do controle de versão: `git rm --cached .env` e adicionar `.env` ao `.gitignore` (hoje ele não está lá).
3. Avaliar limpar o histórico do Git (`git filter-repo` ou BFG Repo-Cleaner) se o repositório tiver colaboradores externos ou puder se tornar público — trocar as credenciais já neutraliza o risco principal, a limpeza do histórico é um reforço.
4. Manter apenas o `.env.example` (com valores fictícios, como já é hoje) versionado.

## 🔴 2. `SESSION_SECRET` com valor padrão fixo no código

**Onde:** `artifacts/api-server/src/middlewares/auth.ts`, linha 5:
```ts
const JWT_SECRET = process.env.SESSION_SECRET ?? "suporte-ti-secret";
```

**Por que importa:** se por qualquer motivo a variável `SESSION_SECRET` não estiver definida no ambiente (erro de configuração, novo servidor, container mal configurado), a aplicação **não quebra — ela continua funcionando silenciosamente usando uma chave fixa, pública, que está neste próprio arquivo**. Qualquer pessoa que veja o código-fonte (e, pelo achado #1, o código já vazou no histórico do Git) pode forjar um token JWT válido para qualquer usuário, incluindo ADMIN, sem precisar de senha nenhuma.

**Correção:** eliminar o fallback. A aplicação deve recusar subir se o segredo não estiver configurado, do mesmo jeito que já acontece em `lib/db/src/index.ts` com `DATABASE_URL`:
```ts
const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  throw new Error("SESSION_SECRET deve estar definido no ambiente.");
}
```

---

## 🟠 3. Sem proteção contra força bruta em login e fluxos de autenticação

**Onde:** `artifacts/api-server/src/routes/auth.ts` — `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password/validate`.

O projeto já tem um utilitário pronto de rate limiting (`lib/rate-limit.ts`, `createInMemoryRateLimiter`), mas ele só é usado em uma rota administrativa (`routes/users.ts`, edição de e-mail). As rotas de autenticação — justamente as que mais interessam a um atacante — não têm nenhum limite de tentativas.

**Impacto prático:**
- **Login:** um atacante pode tentar milhares de senhas por minuto contra uma conta conhecida (força bruta / credential stuffing), sem nenhum bloqueio.
- **Esqueci a senha:** pode ser usado para "bombardear" a caixa de entrada de uma vítima com e-mails de redefinição, ou para enumerar e-mails cadastrados em massa.
- **Registro:** pode ser automatizado para criar contas em massa ou testar CPFs/e-mails já cadastrados.

**Correção:** aplicar `createInMemoryRateLimiter` (já existente, só falta usar) nessas quatro rotas — por exemplo, 5 tentativas por 15 minutos por combinação de IP + e-mail para login, e algo semelhante para as demais. Se a aplicação rodar atrás de mais de uma instância/processo no futuro, trocar o armazenamento em memória por Redis, para o limite valer entre instâncias.

## 🟠 4. Anexos de chamado sem verificação real do conteúdo do arquivo

**Onde:** `artifacts/api-server/src/routes/ticket-attachments.ts`.

A validação de tipo de arquivo (`isAllowedUpload`) confia apenas em dois dados fornecidos pelo **próprio cliente que faz o upload**: o `Content-Type` declarado e a extensão do nome do arquivo. Nenhum dos dois é confiável — um atacante que chame a API diretamente (sem passar pela tela, por exemplo com `curl`) pode enviar qualquer conteúdo dizendo que é uma imagem.

Isso contrasta com o módulo de anexos do chat (`routes/chat-attachments.ts`), que **já faz a coisa certa**: usa `sniffMimeType`/`isAllowedAttachment` (`lib/file-sniff.ts`) para olhar os primeiros bytes reais do arquivo (magic bytes) e confirmar que o conteúdo bate com o tipo declarado.

**Por que isso é mais sério do que parece:** o tipo armazenado (`file.mimetype`, não verificado) é usado depois para decidir se o anexo é servido com `Content-Disposition: inline` — ou seja, para ser **exibido diretamente no navegador** em vez de baixado. Isso inclui `text/plain`. Combinado com o achado #5 (sem cabeçalho `X-Content-Type-Options: nosniff`), existe o risco de um arquivo malicioso disfarçado de `.txt`/imagem ser interpretado pelo navegador de forma diferente do que o servidor declarou — um vetor clássico de XSS armazenado.

**Correção:** aplicar a mesma verificação de conteúdo (`sniffMimeType`) já usada em `chat-attachments.ts` também em `ticket-attachments.ts`, rejeitando arquivos cujo conteúdo real não bata com o tipo declarado.

## 🟠 5. Nenhum cabeçalho de segurança HTTP configurado

**Onde:** `artifacts/api-server/src/app.ts` — não há `helmet` nem qualquer configuração manual de cabeçalhos de segurança, nem no `package.json` do `api-server`.

Faltam, entre outros:
- `X-Content-Type-Options: nosniff` — impede o navegador de "adivinhar" o tipo de um arquivo (ver achado #4).
- `X-Frame-Options` / `frame-ancestors` (CSP) — sem isso, a aplicação pode ser carregada dentro de um `<iframe>` em um site malicioso (clickjacking).
- `Content-Security-Policy` — camada extra de defesa contra XSS, mesmo que um dia apareça um.
- `Strict-Transport-Security` (HSTS) — força HTTPS no navegador em visitas futuras.
- `Referrer-Policy` — evita vazar a URL completa (que pode conter tokens em querystring, como o link de redefinição de senha) para terceiros via cabeçalho `Referer`.

**Correção:** adicionar o pacote `helmet` e aplicá-lo logo no início do `app.ts`, antes das rotas:
```ts
import helmet from "helmet";
app.use(helmet());
```
É uma mudança pequena, de baixo risco, e eleva a postura de segurança da aplicação inteira de uma vez.

---

## 🟡 6. Token de sessão em `localStorage`

**Onde:** `artifacts/suporte-ti/src/lib/auth.tsx` e usado em várias páginas (ex.: chave `"ti_support_token"`).

Guardar o JWT em `localStorage` é uma escolha comum em SPAs e, por si só, não é "errado" — mas tem uma consequência importante: **qualquer código JavaScript que rode na página (inclusive um XSS) consegue ler esse token** e enviá-lo para fora, assumindo a sessão do usuário (inclusive ADMIN) sem precisar de senha.

Hoje não encontramos um XSS ativo e exploravel na aplicação (o conteúdo HTML de mensagens é sanitizado corretamente no backend, ver seção de pontos positivos). Mas o achado #4 mostra que existe uma combinação de fatores que, no futuro, poderia abrir essa porta — e quando isso acontece, o impacto de um token em `localStorage` é máximo (acesso total), porque não há nenhuma barreira adicional.

**Correção (em ordem de esforço):**
1. Curto prazo: fechar os achados #4 e #5 (reduz drasticamente a chance de um XSS acontecer).
2. Médio prazo (mudança arquitetural maior, avaliar com calma): migrar a autenticação para um cookie `httpOnly` + `Secure` + `SameSite=Strict`, em vez de token manipulado via JavaScript. Isso tornaria o token inacessível para qualquer script, mesmo em caso de XSS — mas exige revisar CORS e a lógica de CSRF (hoje dispensável justamente porque não se usa cookie), então é um projeto à parte, não um ajuste pontual.

## 🟡 7. Enumeração de usuários

**Onde:**
- `POST /auth/forgot-password` → retorna `404 "E-mail não encontrado"` quando o e-mail não existe, e uma mensagem de sucesso quando existe.
- `POST /auth/register` → retorna `409 "E-mail já cadastrado"` / `"CPF já cadastrado"`.

Isso permite que um atacante automatize tentativas e descubra quais e-mails (e, no registro, quais CPFs — dado sensível) estão cadastrados no sistema, mesmo sem saber a senha de ninguém.

**Correção:**
- Em `forgot-password`, responder sempre com a mesma mensagem genérica ("Se o e-mail existir em nossa base, enviamos as instruções"), independente de o e-mail existir ou não, e sempre com o mesmo tempo de resposta aproximado (evitar que a diferença de tempo entre "existe" e "não existe" vaze a mesma informação).
- Em `register`, o trade-off é mais discutível (é comum sites avisarem "e-mail já cadastrado" para ajudar o usuário legítimo) — ao menos recomendamos **rate limiting** nessa rota (achado #3) para dificultar automação em massa, já que remover a mensagem pode prejudicar a experiência de cadastro.

## 🟡 8. CORS aberto para qualquer origem

**Onde:** `artifacts/api-server/src/app.ts`, linha 30: `app.use(cors());` — sem nenhuma opção, o que libera qualquer origem.

Como a autenticação usa token via cabeçalho `Authorization` (não cookie), o risco prático é menor do que seria em um esquema baseado em cookie — um site malicioso não consegue "andar" pela sessão do usuário sem conseguir ler o token primeiro. Ainda assim, é uma configuração mais aberta do que o necessário: qualquer site na internet pode fazer chamadas à API e ler respostas (por exemplo, de rotas que não exigem autenticação).

**Correção:** restringir à origem conhecida da aplicação:
```ts
app.use(cors({ origin: process.env.APP_PUBLIC_URL, credentials: false }));
```

## 🟡 9. Proteções de HTTPS/CSRF existem mas cobrem 1 rota só

**Onde:** `middlewares/security.ts` define `requireHttpsInProduction` e `requireSameOriginInProduction`, mas o único lugar onde são usados é `routes/users.ts` (edição de e-mail por admin).

Pelo mesmo motivo do achado #8 (token via header, não cookie), o risco de CSRF é baixo hoje — mas o HTTPS obrigatório é uma boa prática independente disso, e vale aplicar de forma global.

**Correção:** aplicar `requireHttpsInProduction` globalmente em `app.ts`, logo no início:
```ts
app.use(requireHttpsInProduction);
```
`requireSameOriginInProduction` pode continuar restrito a ações administrativas sensíveis (como já está), já que o modelo de autenticação via header já mitiga CSRF na maior parte dos casos.

## 🟡 10. Token JWT de longa duração sem revogação

**Onde:** `middlewares/auth.ts` — `expiresIn: "7d"`; `POST /auth/logout` apenas responde `{ message: "Sessão encerrada" }`, sem invalidar nada no servidor.

Se um token vazar (por exemplo, por um dispositivo roubado com a aba aberta, ou por um dos cenários acima), ele continua válido por até 7 dias mesmo depois do "logout", porque o logout só limpa o `localStorage` do navegador — o token em si continua assinado e válido para o servidor.

**Correção, do mais simples ao mais robusto:**
- Reduzir o tempo de expiração (ex.: 1–2 dias) e reautenticar com mais frequência.
- Implementar uma lista de tokens revogados (ex.: tabela no banco com o `jti` do token ou hash do token, checada em `requireAuth`) para que o logout e a troca de senha realmente invalidem sessões antigas — já existe, inclusive, uma tabela de auditoria (`securityAuditLogsTable`) que mostra que o projeto já pensa nesses termos.

---

## 🟢 Achados de baixa severidade / melhorias de higiene

**11. Fallback de URL em `resolvePublicBaseUrlFromRequest` (auth.ts)** confia em `Origin`/`Referer` do pedido para montar o link de redefinição de senha, caso `APP_PUBLIC_URL` não esteja configurado. Hoje, como `APP_PUBLIC_URL` está sempre definido em produção, esse trecho nunca é alcançado — mas é um padrão arriscado (confiar em cabeçalho controlado pelo cliente para montar uma URL sensível enviada por e-mail). Recomendação: remover esse fallback e usar sempre `getAppPublicUrl()` (que já existe em `lib/password-reset.ts` e falha de forma segura).

**12. Handler de erro genérico vaza uma dica interna.** Em `app.ts`, ao detectar os códigos de erro do Postgres `42703`/`42P01` (coluna/tabela inexistente), a resposta inclui o texto `"Banco desatualizado. Rode: pnpm --filter @workspace/db run push"`. É um detalhe pensado para ajudar durante o desenvolvimento, mas em produção expõe para qualquer cliente da API que o backend usa Postgres/Drizzle e o nome de um comando interno. Recomendação: logar esse detalhe (já é logado) e devolver ao cliente só a mensagem genérica.

**13. `file-sniff.ts` tem bugs conhecidos** (ausência de assinaturas para HEIC/XLS/XLSX, e uma confusão entre HEIC e MP4 pela semelhança do cabeçalho `ftyp`). Hoje ele é usado em `chat-attachments.ts`, então esses bugs podem causar falsos negativos (rejeitar um HEIC ou XLSX legítimo vindo de celular). Vale corrigir antes de estender esse mesmo sniffing para `ticket-attachments.ts` (achado #4), para não espalhar o bug para mais um lugar.

**14. `.env.example` usa o usuário `postgres`** (superusuário do Postgres) na string de conexão de exemplo. Se a produção também usa esse usuário, qualquer vulnerabilidade de SQL injection (hoje não encontramos nenhuma, mas vale como prevenção em camadas) teria acesso irrestrito ao banco inteiro, não só às tabelas da aplicação. Recomendação: criar um usuário de banco dedicado à aplicação, com permissão apenas no schema usado.

**15. Sem verificação automatizada de dependências vulneráveis.** Não há `pnpm audit`, Dependabot ou similar configurado no fluxo do projeto. Recomendação: rodar `pnpm audit` periodicamente (ou ativar o Dependabot do GitHub, já que o repositório está lá) para saber quando uma biblioteca usada (express, jsonwebtoken, multer etc.) tiver uma vulnerabilidade conhecida corrigida em versão mais nova.

---

## O que já está bem feito (vale preservar)

- **Sem SQL Injection em lugar nenhum revisado.** Todas as consultas usam o Drizzle ORM com valores parametrizados (`eq`, `and`, `inArray` etc.); os poucos usos de `sql\`...\`` (ex.: `municipalities-sync.ts`) são para DDL fixo, sem interpolação de dado de usuário.
- **Senhas com bcrypt (custo 10)**, política de senha forte (mínimo 8 caracteres, letra, número e caractere especial) e **bloqueio de reuso das 2 últimas senhas**.
- **Tokens de redefinição de senha bem implementados**: gerados com `crypto.randomBytes(32)`, armazenados como hash SHA-256 (nunca em texto puro), de uso único, com expiração de 1 hora, e cada evento relevante (solicitado, usado, expirado, negado) é registrado em uma tabela de auditoria de segurança.
- **Controle de acesso a chamados bem granular** (`lib/access.ts`, `lib/ticket-access-policy.ts`): regras específicas por papel (ADMIN, ANALYST, COORDINATOR, GESTOR, USER), incluindo colaboradores de chamado, e toda tentativa de acesso negado é logada com o ator, o chamado e a ação tentada — ótimo para investigar incidentes.
- **Mensagens de chamado em HTML passam por sanitização real no servidor** (`sanitizeTicketMessageHtml`, via `sanitize-html`) com lista de tags/atributos permitidos bem restrita — é o jeito certo de permitir rich text sem abrir XSS.
- **Mensagens de erro de login já são genéricas** ("Credenciais inválidas" tanto para e-mail inexistente quanto para senha errada), evitando enumeração nesse ponto específico.
- **Uploads de anexo de chamado em mensagens** usam nome de arquivo gerado por UUID no disco (não o nome original), evitando path traversal mesmo com um nome de arquivo malicioso.

---

## Plano de ação sugerido

**Agora (horas, não dias):**
1. Trocar `SESSION_SECRET`, senha do banco e senha SMTP (achados #1 e #2).
2. Remover `.env` do Git e adicioná-lo ao `.gitignore`.
3. Remover o fallback hardcoded do `SESSION_SECRET` no código.

**Esta semana (mudanças pequenas e isoladas):**
4. Adicionar `helmet()` em `app.ts` (achado #5).
5. Aplicar `createInMemoryRateLimiter` em login, registro, esqueci-senha e validação de token (achado #3).
6. Restringir CORS à origem da aplicação (achado #8).
7. Ajustar a mensagem de `forgot-password` para não revelar se o e-mail existe (achado #7).

**Próximas semanas (mudanças um pouco maiores, mas ainda pontuais):**
8. Estender a verificação de conteúdo real de arquivo (`sniffMimeType`) para os anexos de chamado (achado #4), depois de corrigir os bugs de detecção do HEIC/XLS/XLSX (achado #13).
9. Aplicar `requireHttpsInProduction` globalmente (achado #9).
10. Reduzir a validade do token JWT e/ou implementar uma lista de revogação (achado #10).

**Quando houver tempo para planejar (mudança arquitetural, avaliar com calma):**
11. Migrar o token de sessão de `localStorage` para cookie `httpOnly` (achado #6) — maior impacto na defesa contra XSS, mas exige revisar CORS/CSRF junto.
