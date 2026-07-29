[OPEN] Debug Session: mobile-white-screen

## Sintoma
- Mobile: carregamento infinito e tela totalmente branca.
- Desktop: comportamento esperado (a confirmar).

## Objetivo
- Identificar a causa raiz com evidência de runtime (logs estruturados).
- Corrigir o problema sem regressão das rotas públicas e do shell autenticado.
- Validar responsividade sem remodelação visual disruptiva.

## Hipóteses (falsificáveis)
1. O app entra em loop de redirecionamento (ex.: `requireActive`/`/pendente`) por estado de autenticação inconsistente no mobile.
2. Uma requisição crítica falha no mobile (CORS/SameSite/cookie/localStorage) e a UI fica presa em “loading” sem fallback.
3. Um erro JS ocorre apenas no mobile (polyfill, API não suportada, erro de layout/resize) e quebra a renderização do React.
4. Assets/CSS/JS não carregam em mobile (cache, MIME, caminho, service worker), resultando em tela branca.
5. Há travamento por layout responsivo (overflow/height 100vh/scroll container) que oculta conteúdo e aparenta “branco”.

## Evidências necessárias
- Console errors e network failures no mobile.
- Linha do tempo de boot (hydrate → auth restore → fetches → route).
- Estado do usuário no momento do loop: role/status, pathname e respostas da API.

## Plano
1. Instrumentar pontos mínimos (boot, roteamento, auth restore, chamadas críticas) enviando logs para o Debug Server.
2. Reproduzir em 3 modelos de mobile (emulação) e 2 resoluções desktop.
3. Confirmar/invalidar hipóteses com logs (pre-fix).
4. Aplicar correção mínima (fix).
5. Retest com logs (post-fix) e comparar.

## Checklist de validação
- [ ] Tela inicial não fica branca no mobile
- [ ] Login/registro/pendente funcionam
- [ ] Rotas autenticadas carregam
- [ ] Sem loop de redirects
- [ ] Sem erros no console
- [ ] Layout não quebra em mobile e desktop

## Registro
- Pré-fix logs: (a coletar)
- Pós-fix logs: (a coletar)
