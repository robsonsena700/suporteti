# Manual do Usuário — Chamados (Atualização)

## Visualização em Cards

- A listagem de chamados foi redesenhada para exibição em formato de cards.
- Cada card apresenta:
  - Solicitante (nome do usuário)
  - Localização no formato `UF - Município`
  - Responsável (quando atribuído)
- A tela se adapta automaticamente para celular/tablet/desktop.

### Filtros e Ordenação

- Filtros adicionais:
  - Usuário (solicitante)
  - Localização (UF ou Município)
  - Responsável
- Ordenação:
  - Data, Usuário, Localização ou Responsável
  - Ordem crescente/decrescente

## Novo Chamado

### Campo obrigatório: Estabelecimento / Unidade de saúde

- O campo `Estabelecimento / Unidade de saúde` passou a ser obrigatório.
- O campo permite digitação livre (texto) e possui limite máximo de caracteres.

### Anexo obrigatório

- É obrigatório anexar pelo menos 1 arquivo ao abrir um chamado.
- O formulário mostra um contador de anexos e bloqueia o envio se nenhum arquivo estiver anexado.

## Anexos

- O sistema valida tipos permitidos e tamanho máximo por arquivo.
- Na tela do chamado, cada anexo possui:
  - Botão de visualização (quando suportado pelo navegador)
  - Botão de download

## Regras de Acesso (Chamados)

- Visualização:
  - Criador do chamado e responsável atual podem visualizar.
  - Admin e Analista podem visualizar chamados mesmo sem atribuição.
  - Coordenador pode visualizar chamados dos usuários vinculados ao seu perfil (e os atribuídos a ele).
  - Gestor pode visualizar:
    - chamados do Coordenador principal ao qual está vinculado (inclui os usuários subordinados do Coordenador),
    - chamados de usuários adicionais explicitamente adicionados na configuração do Gestor.
- Interação:
  - Apenas o criador e o responsável atual podem interagir (enviar mensagens e anexar arquivos).
  - Admin/Analista não conseguem enviar mensagens até que o chamado seja atribuído a eles.
  - Gestor segue as mesmas regras de interação do perfil Coordenador, respeitando o mesmo escopo de permissão (com a restrição adicional de não poder ser definido como Responsável do chamado).

## Perfil Gestor (Administração)

### Objetivo

- O perfil `Gestor` foi criado para atuar como “assistente/subordinado” de um `Coordenador`, com acesso a Relatórios e chamados dentro do seu escopo, com as mesmas regras de visualização e interação do perfil `Coordenador` no módulo de chamados, e sem acesso ao módulo de Chat.

### Criação do Perfil no Banco

- O perfil é implementado como um novo valor no enum `user_role` (`GESTOR`) e novas tabelas de vínculo:
  - `gestor_coordinators` (1:1) — Gestor → Coordenador principal
  - `gestor_allowed_users` (N:N) — Gestor → Usuários padrão adicionais (allowlist)
- Migração: `lib/db/migrations/0012_gestor_role_and_access.sql`

### Como Vincular um Gestor a um Coordenador

- Ao aprovar um usuário pendente com perfil `Gestor`, selecione um `Coordenador principal`.
- Um Gestor ativo deve possuir um Coordenador principal vinculado.

### Como Configurar Usuários Adicionais (Allowlist)

- Na tela de configurações administrativas, selecione o usuário com perfil `Gestor`.
- Defina/atualize:
  - `Coordenador principal`
  - Lista de `Usuários adicionais` que o Gestor também poderá visualizar
- É possível adicionar e remover usuários da lista a qualquer momento.

### Regras de Visualização (Gestor)

- Um Gestor pode visualizar:
  - todos os chamados que o Coordenador principal consegue visualizar (inclui o Coordenador e os usuários subordinados vinculados a ele),
  - chamados de usuários padrão explicitamente adicionados na allowlist do Gestor.
- Além disso, o Gestor enxerga chamados onde o Coordenador principal:
  - é o responsável (atribuído), ou
  - está como colaborador no chamado.

### Restrição (Responsável)

- Não é permitido atribuir chamados como `Responsável` para usuários com perfil `Gestor`.

### Limitações (Gestor)

- Um Gestor não possui acesso ao módulo de Chat.

### Testes

- Unitários (política de acesso): `pnpm run test:tickets:access-policy:unit`
- Integração (escopo + permissões equivalentes ao Coordenador): `pnpm run test:gestor:access-control:integration`

### Pré-visualização

- Suportado diretamente na interface:
  - Imagens
  - PDF
  - TXT
- Para documentos Office, o arquivo pode ser baixado e aberto no aplicativo do dispositivo.

