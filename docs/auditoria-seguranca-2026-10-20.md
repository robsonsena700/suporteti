# Nova varredura de segurança — SuporteTI (20/10/2026)

Varredura completa em código, backend, frontend, banco de dados e infraestrutura de deploy, cruzando com as classes de vulnerabilidade de maior criticidade reconhecidas atualmente no mercado (OWASP Top 10, CWE Top 25, advisories do npm/GitHub para as dependências exatas em uso). Esta varredura é adicional às Etapas 1–6 já implementadas e publicadas — nenhum item abaixo repete o que já foi corrigido.

Metodologia: revisão manual de todas as rotas do backend, dos componentes de frontend que renderizam dados de usuário, do schema/migrations do banco e dos scripts de deploy/servidor, mais um `npm audit` real rodado contra as versões exatas (resolvidas no `pnpm-lock.yaml`) de todas as dependências de produção.

---

## CRÍTICO

### 1. `sanitize-html@2.17.3` tem uma vulnerabilidade crítica confirmada na versão exata instalada, e o conteúdo que ela sanitiza é renderizado como HTML real no navegador

Rodando `npm audit` contra a versão exata resolvida no lockfile (`sanitize-html@2.17.3`), aparecem como **crítico**:

- [GHSA-rpr9-rxv7-x643](https://github.com/advisories/GHSA-rpr9-rxv7-x643) — XSS por padrão via "passthrough" de texto bruto da tag `xmp`, afeta exatamente a versão `2.17.3`.
- [GHSA-vccv-cmxp-4j9h](https://github.com/advisories/GHSA-vccv-cmxp-4j9h) — validação incompleta de esquema de URI, permitindo `javascript:` passar através dos atributos `action`, `formaction`, `data`, `poster` e `background`.

Isso importa aqui porque `lib/ticket-message-content.ts` (`sanitizeTicketMessageHtml`) usa exatamente essa biblioteca pra sanitizar mensagens de chamado em formato HTML, e `pages/ticket-detail.tsx:1533` renderiza esse conteúdo com **`dangerouslySetInnerHTML`** — ou seja, qualquer bypass da sanitização executa JavaScript real no navegador de quem abrir o chamado (inclusive ADMIN/GESTOR), com o JWT guardado em `localStorage` (texto puro, sem `httpOnly`) completamente exposto a esse script. Esse é o pior cenário possível: chamado malicioso → sessão de admin roubada → controle total da conta.

**Correção:** atualizar `sanitize-html` para `>=2.18.1` (correção não-major, baixo risco de quebra, já disponível). Etapa recomendada imediata.

### 2. Node.js 20 em produção está fora do ciclo de vida (EOL) há cerca de 6 meses

`scripts/remote/start_prod.sh` fixa `nvm use 20` para rodar a API em produção. O Node.js 20 **encerrou o suporte oficial em 30/04/2026** — já são ~6 meses sem nenhum patch de segurança. Já houve, inclusive, um pacote de correções de julho/2026 com 11 CVEs cobrindo justamente as versões 18 e 20, que **nunca serão corrigidas** nessa versão porque ela não recebe mais atualização alguma do projeto Node.js.

**Correção:** migrar o servidor de produção para Node.js 24 (LTS atual recomendado) — isso é uma mudança de infraestrutura no servidor (instalar a versão via `nvm install 24` e ajustar `start_prod.sh`), não de código da aplicação, mas é urgente porque toca diretamente a superfície de ataque do runtime que processa toda requisição.

Fontes: [Node.js v20 end of life](https://endoflife.ai/nodejs/20), [Node.js July 2026 security release — 11 CVEs, Node 18/20 EOL](https://www.herodevs.com/blog-posts/node-js-july-2026-security-release-11-cves-node-18-and-20-eol)

---

## ALTO

### 3. Upload de anexo em mensagens de chamado (`routes/messages.ts`) não faz verificação de bytes mágicos — inconsistente com o resto do app

A Etapa 5 endureceu `ticket-attachments.ts` com sniff real de conteúdo (`lib/file-sniff.ts`), e `chat-attachments.ts` já tinha esse padrão antes disso. Mas `validateTicketMessageAttachmentFile` (usada em `routes/messages.ts:133`, a rota de anexo em **mensagens de chamado**) só confere extensão + `Content-Type` declarado pelo cliente — ambos trivialmente falsificáveis (ex: `curl`/Postman). O arquivo depois é servido de volta com `Content-Disposition: inline` para tipos "imagem" (`messages.ts:325`), usando o `mimeType` **armazenado** (não verificado) como o header `Content-Type` da resposta.

O cabeçalho `X-Content-Type-Options: nosniff` do Helmet (já ativo desde a Etapa 2) reduz bastante o risco prático de execução no navegador, mas a lacuna é real e é exatamente a mesma classe de problema já corrigida em outro lugar do mesmo app — convém fechar por consistência e defesa em profundidade.

**Correção:** aplicar o mesmo `lib/file-sniff.ts` usado em `ticket-attachments.ts` também em `messages.ts`.

### 4. Auto-link de URL em mensagens HTML constrói HTML por concatenação de string antes do sanitizador

Em `lib/ticket-message-content.ts`, a regex `/(^|[\s(>])((https?:\/\/)[^\s<]+)/g` captura qualquer caractere que não seja espaço ou `<` como parte da URL — isso inclui `"` e `>` — e insere o resultado direto num atributo `href="${url}"` por concatenação de string, **antes** de chamar `sanitizeHtml`. Hoje a lista restrita de tags/atributos permitidos (`allowedAttributes.a = ["href","target","rel"]`) parece conter tentativas simples de injeção de atributo, mas esse padrão (montar HTML "a mão" e confiar no sanitizador pra limpar depois) é historicamente a origem de bypasses de mutação (mXSS) — e, com o achado #1 mostrando que o próprio sanitizador tem um bypass crítico confirmado nesta versão, os dois problemas se somam.

**Correção:** escapar (`&quot;`, `&lt;`, `&gt;`) o texto capturado antes de montar o `<a href="...">`, e idealmente parar de capturar a URL em `"`/`'`/`<`/`>`, não só em espaço.

### 5. `multer@2.1.1` tem 5 vulnerabilidades de negação de serviço conhecidas, afetando todo upload de arquivo do sistema

`npm audit` aponta, todas de severidade **alta**, afetando a versão exata instalada:

- [GHSA-72gw-mp4g-v24j](https://github.com/advisories/GHSA-72gw-mp4g-v24j) — DoS via nomes de campo profundamente aninhados
- [GHSA-3p4h-7m6x-2hcm](https://github.com/advisories/GHSA-3p4h-7m6x-2hcm) — DoS via limpeza incompleta de uploads abortados
- [GHSA-wc9g-mqfw-jrwm](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm) — DoS via nomes de campo multipart manipulados
- [GHSA-qvfw-j98x-7q72](https://github.com/advisories/GHSA-qvfw-j98x-7q72) — bypass do limite de tamanho de arquivo via race condition no `fileFilter`
- [GHSA-535w-7cp7-47q4](https://github.com/advisories/GHSA-535w-7cp7-47q4) — DoS via índice de array superdimensionado em nomes de campo

Atinge todas as três rotas de upload (`ticket-attachments.ts`, `chat-attachments.ts`, `messages.ts`).

**Correção:** atualizar para `multer@2.4.0` — correção não-major, já disponível.

### 6. `nodemailer@6.10.1` acumula múltiplas vulnerabilidades altas, incluindo injeção de comando SMTP e SSRF

Mais de 10 advisories de severidade alta atingem a versão instalada, entre elas injeção de comando SMTP/CRLF em cabeçalhos, bypass de allow-list de domínio, e SSRF/leitura arbitrária de arquivo via a opção `raw` de mensagem. Usado para e-mail de reset de senha (Etapa 4).

**Correção:** atualizar para a major mais recente (`10.x`) — exige teste, pois é bump de major, mas recomendo priorizar dado o volume e a severidade dos advisories.

### 7. Falta rate limiting em criação de chamado, envio de mensagem e exportação de relatório

O limitador (`lib/rate-limit.ts`) só é usado em `auth.ts` e numa rota de `users.ts`. `POST /tickets`, `POST /tickets/:id/messages`, `POST /chat/messages`, `POST /chat/dm/:userId` e os dois endpoints de exportação de relatório (que geram PDF/XLSX de forma síncrona) não têm limite algum. Qualquer usuário autenticado comum pode scriptar centenas de requisições por segundo contra esses endpoints — spam de chamados/mensagens, ou exaustão de CPU/memória do processo Node forçando geração repetida de relatório pesado.

**Correção:** aplicar `createInMemoryRateLimiter` nessas rotas, priorizando criação de ticket/mensagem e os dois exports.

### 8. Ferramenta de debug de terceiros carregável em produção por qualquer visitante, sem controle de versão

`pages/new-ticket.tsx` injeta `<script src="https://cdn.jsdelivr.net/npm/eruda@3/eruda.min.js">` sempre que a URL tem `?debug=1` — **sem checar ambiente (dev/produção) nem autenticação**. Qualquer um que acesse `.../chamados/novo?debug=1` em produção carrega esse script de terceiro, fixado só no major (`eruda@3`, sem SRI), tornando o app vulnerável a um eventual comprometimento de supply-chain do pacote `eruda` ou do próprio jsDelivr (o tipo de ataque que já aconteceu com `polyfill.io`, `event-stream`, `ua-parser-js`). Essa é também a razão de `cdn.jsdelivr.net` precisar estar liberado em `scriptSrc` na CSP de produção — uma origem externa de script permanentemente aberta.

**Correção:** gatear por `import.meta.env.DEV` (ou flag de build interna), e se possível remover `cdn.jsdelivr.net` da CSP de produção quando o debug ficar restrito a desenvolvimento.

### 9. Senha do PostgreSQL em texto plano no servidor sem permissão de arquivo explícita

`shared/credenciais.txt` guarda a senha do usuário `postgres` (superuser) em texto puro, lida em `start_prod.sh` e `uploads_guard.sh`. Diferente de `shared/session_secret` (que recebe `chmod 600` explícito em `start_prod.sh:51`), **nenhum script aplica `chmod` nesse arquivo** — se foi criado com umask padrão (644), qualquer outro processo/usuário local no servidor consegue ler a senha do superuser do banco.

**Correção:** aplicar `chmod 600` em `credenciais.txt` dentro de `start_prod.sh`, e confirmar manualmente a permissão atual no servidor (`ls -l` no arquivo).

### 10. Aplicação conecta no PostgreSQL como superuser (`postgres`), não como usuário de privilégio mínimo

Reforçando o que já havia sido sinalizado após a Etapa 6: `DATABASE_URL` é montada com `postgres:` tanto em `start_prod.sh` quanto em `uploads_guard.sh`. Qualquer vazamento do arquivo de credenciais (achado #9) ou de uma eventual falha de injeção dá acesso total ao cluster Postgres, não só às tabelas da aplicação.

**Correção:** criar um usuário de banco dedicado com permissão só nas tabelas que a aplicação usa (sem `CREATEDB`/`CREATEROLE`/superuser) — item de infraestrutura, não de código, já estava pendente de decisão sua.

---

## MÉDIO

### 11. Verificação de token JWT não fixa o algoritmo esperado

`verifyToken` chama `jwt.verify(token, JWT_SECRET)` sem passar `algorithms: ["HS256"]`. É prática padrão (OWASP, e recomendação da própria biblioteca `jsonwebtoken`) sempre fixar o algoritmo esperado explicitamente — reduz a superfície a zero contra qualquer classe de ataque de confusão de algoritmo, presente ou futura, mesmo que hoje não haja um par de chaves assimétricas em uso que tornasse isso diretamente explorável.

**Correção:** `jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] })`.

### 12. Custo do `bcrypt` (fator 10) abaixo da recomendação atual

Todos os hashes de senha usam `bcrypt.hash(password, 10)`. É um valor aceitável, mas a recomendação atual (OWASP Password Storage Cheat Sheet, revisões 2024/2025) já indica 12+ dado o avanço de hardware para quebra por força bruta offline.

**Correção:** subir para `12`. Atenção: isso não invalida hashes já existentes (bcrypt grava o custo usado no próprio hash), só passa a valer para novas senhas/trocas.

### 13. `xlsx@0.18.5` (SheetJS) tem vulnerabilidades altas conhecidas, sem correção publicada no npm

`npm audit` aponta prototype pollution ([GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)) e ReDoS ([GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)). A SheetJS parou de publicar correções no registro do npm (recomenda instalar via CDN própria). **Risco reduzido hoje** porque o uso em `routes/reports.ts` é só de **escrita** (gera planilha a partir de dado interno confiável, nunca lê arquivo `.xlsx` enviado por usuário) — os dois bugs vivem no caminho de leitura/parsing. Mas é um risco de cadeia de suprimentos sem correção oficial, e se algum dia o app ganhar um recurso de "importar chamados de Excel" usando essa mesma lib, o risco vira imediato.

**Correção:** considerar trocar para uma lib mantida (ex: `exceljs`) na próxima vez que `reports.ts` for tocado, ou instalar a versão corrigida via CDN oficial da SheetJS.

### 14. Verificação de integridade dos uploads só confere existência, não conteúdo

`uploads_guard.sh verify` confere apenas se o arquivo existe no caminho esperado — não compara hash/checksum. Uma substituição silenciosa de anexo (mesmo nome, conteúdo trocado) não seria detectada. Só explorável por quem já tem acesso de escrita ao filesystem do servidor, mas é uma lacuna de integridade real.

**Correção:** gravar SHA-256 do arquivo no momento do upload (nova coluna) e comparar no `verify()`.

### 15. Backup de uploads sem criptografia

`uploads_guard.sh backup` gera `.tar.gz` sem criptografia, protegido só pela permissão do diretório (`chmod 700`, correta). Sem camada adicional se a permissão falhar ou o backup for copiado pra outro lugar no futuro.

### 16. `vite@7.3.2` tem 2 advisories altos, mas restritos ao servidor de desenvolvimento (não afetam produção)

Bypass do `server.fs.deny` e exposição de hash NTLMv2 via caminho UNC no Windows — ambos no **servidor de dev** do Vite, que não roda em produção (lá é servido o build estático via Express). Risco real baixo, mas correção é barata.

**Correção:** atualizar para `vite@7.3.7` (não-major).

---

## BAIXO / INFORMATIVO

- **`cookie-parser` instalado mas nunca usado no código** (autenticação é via Bearer token, não cookie) — dependência morta, superfície extra sem necessidade. Pode remover do `package.json`.
- **`apply_sql_migrations.sh:67`** interpola `$filename` direto numa string SQL sem usar `psql -v`. Não é explorável remotamente (`$filename` vem de arquivos `.sql` já versionados no repositório), mas é um padrão frágil — prefira parametrização mesmo em contexto de confiança.
- **Vários `db.select().from(usersTable)` sem projeção de colunas** trazem a linha completa (incluindo `passwordHash`) para variáveis locais em `tickets.ts`, `users.ts`, `chat.ts`, `direct-messages.ts` — confirmado que em **todos** os pontos de serialização o código filtra explicitamente só `{id, name, email, role}` antes de responder, então não há vazamento ativo hoje. Recomendação de higiene: projetar só as colunas necessárias no próprio `select()`, pra que um futuro `res.json(objetoCompleto)` acidental não vaze o hash de senha.
- **`drizzle-kit`/`esbuild`/`@esbuild-kit/*`** têm advisories moderados, mas são ferramentas de build/dev time — não rodam no processo de produção.

---

## Confirmado limpo (checado explicitamente, sem achado)

- Exportação/impressão de relatórios (`reports.ts`, formato `print`) escapa corretamente todo valor interpolado, incluindo título de chamado e nomes de usuário — sem XSS.
- Controle de acesso (IDOR) consistente em todas as rotas de chamados, mensagens, chat e usuários — `enforceTicketAccess`/checagem de role sempre presente antes de ler/escrever um recurso específico.
- Nenhum SQL cru/não-parametrizado em todo o backend — todo uso de `` sql`...` `` do Drizzle é parametrizado automaticamente.
- Nenhuma vulnerabilidade de mass assignment — schemas Zod excluem campos sensíveis, e campos críticos são sobrescritos explicitamente após qualquer spread de corpo de requisição.
- Todas as rotas administrativas têm `requireRoles` — nenhuma rota órfã sem autenticação (as únicas públicas são dados de referência do IBGE, sem dado sensível).
- `/uploads` não é servido via `express.static` — todo acesso a anexo passa por rota autenticada.
- `email`/`cpf` têm `unique()` no schema — sem risco de corrida na criação de conta duplicada.
- Tokens de reset de senha são armazenados como hash (não texto plano), com IP/user-agent de auditoria.
- Nenhuma chave de API, segredo ou credencial hardcoded no bundle do frontend; nenhum open redirect; nenhum log de token/senha sobrevivendo em build de produção.
- Política de `minimumReleaseAge` (24h) do pnpm contra ataque de supply-chain está ativa e não é contornada em nenhum ponto do código.
- `jsonwebtoken@9.0.3`, `bcryptjs@3.0.3`, `express@5.2.1`, `helmet@8.3.0`, `cors@2.8.6`, `pino`/`pino-http`, `pdf-lib@1.17.1`, `pg@8.20.0`, `drizzle-orm@0.45.2`, `react`/`react-dom@19.1.0`, `wouter@3.9.0`, `zod@3.25.76`, `tailwindcss@4.2.1` — nenhuma vulnerabilidade conhecida na versão instalada, segundo `npm audit`.

---

## Plano sugerido de próximas Etapas (por criticidade)

| Etapa | Conteúdo | Severidade |
|---|---|---|
| 7 | Atualizar `sanitize-html` (≥2.18.1) + corrigir o regex de auto-link (achados #1 e #4) | Crítico |
| 8 | Migrar Node.js de produção (20 → 24) | Crítico |
| 9 | Aplicar sniff de conteúdo em `messages.ts` (achado #3) + atualizar `multer` (achado #5) | Alto |
| 10 | Rate limiting em criação de chamado/mensagem/export (achado #7) + gatear `eruda` por ambiente (achado #8) | Alto |
| 11 | `chmod 600` em `credenciais.txt` no servidor + atualizar `nodemailer` (achados #9 e #6, maior esforço por ser bump de major) | Alto |
| 12 | Itens médios: fixar algoritmo no `jwt.verify`, subir custo do bcrypt para 12, hash de integridade nos uploads, atualizar `vite` | Médio |

Como sempre, posso seguir implementando uma Etapa por vez, você testa/aprova e a gente segue pra próxima — igual temos feito até aqui.

---

### Fontes consultadas nesta varredura
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/)
- [CWE Top 25 Most Dangerous Software Weaknesses — CISA](https://cisa.gov/news-events/alerts/2024/11/20/2024-cwe-top-25-most-dangerous-software-weaknesses)
- [Node.js v20 end of life](https://endoflife.ai/nodejs/20)
- [Node.js July 2026 security release — 11 CVEs, Node 18/20 EOL](https://www.herodevs.com/blog-posts/node-js-july-2026-security-release-11-cves-node-18-and-20-eol)
- GitHub Advisory Database (via `npm audit`): sanitize-html, multer, nodemailer, xlsx, vite, esbuild/drizzle-kit
