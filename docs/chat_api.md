# Chat API

## Requisitos de Acesso

- Todas as rotas exigem `Authorization: Bearer <token>`
- Acesso ao módulo de chat: roles `ADMIN`, `COORDINATOR`, `ANALYST`

## Mensagens (Grupo)

### Stream (tempo real)

`GET /api/chat/stream`

- Server-Sent Events (SSE)
- Eventos:
  - `group_message`
  - `group_message_edited`
  - `dm_message`
  - `dm_message_edited`

### Listar mensagens

`GET /api/chat/messages?limit=200&afterId=<id>`

- `afterId` (opcional): retorna somente mensagens com `id` maior que `afterId`
- Resposta inclui `attachments`, `replyTo`, `editedAt` e `editHistory` (somente para `ADMIN` ou autor da mensagem)

### Enviar mensagem

`POST /api/chat/messages`

Body:
```json
{
  "message": "texto (opcional se houver anexos)",
  "attachmentIds": [1,2],
  "replyToId": 123
}
```

### Editar mensagem (até 2 minutos)

`PATCH /api/chat/messages/:id`

Body:
```json
{ "message": "novo texto" }
```

## Mensagens Diretas (DM)

### Inbox (última atividade por conversa)

`GET /api/chat/dm-inbox`

Resposta:
```json
[
  {
    "partnerId": 2,
    "partnerName": "Fulano",
    "partnerRole": "ANALYST",
    "lastMessage": "texto",
    "lastMessageAt": "2026-04-20T12:34:56.000Z",
    "lastMessageId": 123,
    "fromMe": false
  }
]
```

### Listar mensagens

`GET /api/chat/dm/:userId?afterId=<id>`

### Enviar mensagem

`POST /api/chat/dm/:userId`

Body:
```json
{
  "message": "texto (opcional se houver anexos)",
  "attachmentIds": [1,2],
  "replyToId": 123
}
```

### Editar mensagem (até 2 minutos)

`PATCH /api/chat/dm/message/:id`

Body:
```json
{ "message": "novo texto" }
```

## Anexos

### Upload (pré-envio)

`POST /api/chat/attachments/upload?scope=GROUP|DM&receiverId=<id>`

- multipart/form-data
- campo: `files` (múltiplos)
- limita 5MB por arquivo
- valida extensão + MIME + assinatura (magic bytes)

### Download

`GET /api/chat/attachments/:id/download`

### Excluir

`DELETE /api/chat/attachments/:id`
