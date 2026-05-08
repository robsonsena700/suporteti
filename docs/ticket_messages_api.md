# API — Mensagens do Chamado (Rich Text + Anexos)

## Enviar mensagem (texto simples)

**POST** `/api/tickets/{ticketId}/messages`  
`Content-Type: application/json`

Body:
```json
{
  "message": "texto simples"
}
```

## Enviar mensagem (HTML seguro) com anexos

**POST** `/api/tickets/{ticketId}/messages`  
`Content-Type: multipart/form-data`

Campos:
- `format`: `HTML` (ou `PLAIN`)
- `message`: string (HTML será sanitizado no servidor)
- `files`: até **5** arquivos

Regras de upload:
- Tipos permitidos: **PNG**, **JPG/JPEG**, **PDF**
- Tamanho máximo: **3MB por arquivo**
- Validação dupla: MIME + extensão

## Listar mensagens (inclui anexos)

**GET** `/api/tickets/{ticketId}/messages`

Retorno (por item):
- `format`: `PLAIN` | `HTML`
- `attachments`: lista com `{ id, messageId, ticketId, filename, mimeType, size, createdAt }`

## Listar anexos de uma mensagem

**GET** `/api/tickets/{ticketId}/messages/{messageId}/attachments`

## Baixar/visualizar anexo de uma mensagem

**GET** `/api/tickets/{ticketId}/messages/{messageId}/attachments/{attachmentId}`

Query:
- `download=true|false` (quando `false`, imagens/PDF podem abrir inline)

