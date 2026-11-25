// Colunas de usuario usadas quando um usuario aparece "embutido" em outra
// entidade (autor/responsavel do chamado, remetente de mensagem, colaborador).
// Sem isso, relacoes como `with: { createdBy: true }` traziam a linha inteira
// de users - incluindo password_hash e avatar_data (imagem em base64) - para
// CADA chamado/mensagem listado, so para depois usar id/nome/email/perfil.
export const USER_SUMMARY_COLUMNS = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const;
