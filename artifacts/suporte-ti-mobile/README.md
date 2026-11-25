# Suporte TI — app mobile (Expo)

App React Native (Expo) que consome a mesma API do SuporteTI web
(`@workspace/api-server`), reusando os pacotes `@workspace/api-client-react`
(hooks de React Query + `customFetch`) e `@workspace/api-zod` (tipos) ja
existentes no monorepo.

## Escopo desta primeira versao

- Login e autenticacao (token persistido com `expo-secure-store`).
- Listagem e detalhe de chamados.
- Abrir novo chamado com anexo (camera/galeria).
- Mensagens dentro do chamado (com anexo de imagem).

Fora do escopo por enquanto: chat/mensagens diretas entre usuarios (o
`chat.tsx` do app web, separado das mensagens de um chamado), relatorios e
telas administrativas.

## Configuracao

A URL base da API fica em `app.json`, em `expo.extra.apiBaseUrl` (hoje
apontando para `https://suporteti.sotechsaude.com.br`). Ajuste ali para
apontar para outro ambiente quando precisar.

## Rodando

Este pacote faz parte do workspace pnpm do SuporteTI. Na raiz do
repositorio:

```powershell
pnpm install
cd artifacts/suporte-ti-mobile
npx expo install --fix   # alinha as versoes dos pacotes expo-* com o SDK
npx expo start
```

Abra no Expo Go (Android/iOS) escaneando o QR code, ou pressione `a`/`i`
para abrir num emulador.

## Observacoes tecnicas

- `metro.config.js` configura o Metro para enxergar a raiz do monorepo e
  resolver os pacotes `@workspace/*` via symlink do pnpm
  (`unstable_enableSymlinks`, `disableHierarchicalLookup`).
- Upload de anexos (criacao de chamado e mensagens) usa `fetch()` direto com
  `FormData`, no mesmo padrao do app web em `ticket-detail.tsx`/
  `new-ticket.tsx` — o hook `useCreateMessage` gerado nao serializa
  `files: Blob[]` corretamente como multipart, entao o anexo real precisa
  ir por fora do cliente gerado.
- O limite de 8 MB por anexo espelha o limite real do backend
  (`ticket-attachments.ts`).
- Esta primeira versao ainda nao foi validada rodando de fato (o ambiente
  Linux desta sessao nao tem pnpm instalavel) — rode `pnpm install` e
  `npx expo start` na sua maquina para testar e ajustar o que for preciso.
- Gerar o `.apk` final requer um passo a parte com EAS Build
  (`npx eas build --platform android`), que nao foi configurado ainda.
