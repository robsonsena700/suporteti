import { createHash } from "node:crypto";

/**
 * Documentos de privacidade do SuporteTI (LGPD), versionados no código.
 *
 * MINUTAS escritas a partir do que o sistema REALMENTE faz (conferido no código e na
 * infraestrutura). Onde a informação depende de decisão do controlador, o texto diz
 * "[A DEFINIR]" em vez de inventar. Enquanto `legallyValidated` for false, a tela mostra
 * "Minuta pendente de validação jurídica".
 *
 * Para alterar um texto: edite o conteúdo, AUMENTE `version` e ajuste `effectiveDate`.
 * O hash muda e todos os usuários verão o aviso de ciência da nova versão.
 *
 * Marcadores trocados na tela: {{controlador}}, {{encarregado}}, {{contato}}.
 * Formato: "## Título", "### Subtítulo", listas com "- " e **negrito**.
 */

export type PrivacyDocumentType = "POLITICA_PRIVACIDADE" | "TERMOS_USO";

export type PrivacyDocument = {
  type: PrivacyDocumentType;
  slug: string;
  title: string;
  version: number;
  effectiveDate: string;
  requiresAcknowledgement: boolean;
  legallyValidated: boolean;
  content: string;
};

const POLITICA = `## 1. Quem é o responsável
O SuporteTI é a plataforma de abertura e acompanhamento de chamados de suporte técnico (sistemas e equipamentos) usada por unidades de saúde e equipes atendidas. O responsável (controlador) pelos dados tratados aqui é {{controlador}}.

[A DEFINIR / VALIDAR PELO JURÍDICO] O papel de cada parte (controlador ou operador) em relação às unidades e órgãos atendidos, conforme os contratos.

## 2. Quais dados tratamos
### Cadastro e conta
- Nome, e-mail, CPF, data de nascimento, telefone de contato e preferência de contato (WhatsApp/Telegram), estabelecimento ou unidade de saúde, UF e município.
- Foto de perfil, se você enviar uma.
- Perfil de acesso (usuário, gestor, coordenador, analista ou administrador), situação do cadastro, data do cadastro e do último acesso.
- **Senha:** guardamos apenas uma versão cifrada (hash), nunca a senha em texto. Também guardamos os hashes das senhas anteriores para impedir a reutilização, e os pedidos de redefinição de senha (o código fica só como hash e expira).

### Chamados e atendimento
- Título, descrição, categoria, prioridade, status, unidade e localização do chamado.
- Mensagens trocadas no chamado e arquivos anexados (imagens e PDF), guardados no banco de dados e no armazenamento de arquivos do servidor.
- Responsável e colaboradores do atendimento, avaliação do atendimento (nota e comentário) e o histórico do chamado (quem fez cada alteração e quando).

### Chat interno da equipe
- Mensagens e arquivos trocados no chat da equipe de suporte (disponível apenas para administradores, coordenadores e analistas).

### Segurança e registros técnicos
- Eventos de segurança da conta (entrada, falhas de login, troca e redefinição de senha, alterações de perfil), com data/hora, endereço IP e navegador.
- Registros técnicos do servidor (data/hora, endereço da página acessada, resultado e tempo de resposta), usados para operar e proteger o sistema.

### Avisos por e-mail
- Enviamos e-mails sobre interações nos seus chamados e para redefinição de senha. Os avisos de chamado **não incluem o conteúdo das mensagens**: trazem o número, o título e um link para entrar no sistema.
- Registramos que um aviso foi enviado (chamado, destinatário e data), **sem guardar o endereço de e-mail nem o conteúdo** do aviso.

### Registros de privacidade
- Aceites e ciências desta Política e dos Termos de Uso (versão, data/hora e IP) e as solicitações que você fizer como titular de dados.

## 3. Dados de pacientes e dados sensíveis
O SuporteTI **não foi feito para tratar dados de pacientes**. Não informe nomes, CPF, diagnósticos ou outros dados de saúde de pacientes nos chamados, mensagens ou anexos (inclusive em capturas de tela). Se for indispensável mostrar uma tela com dados de pacientes para resolver o problema, oculte as informações antes de anexar.

## 4. Para que usamos e em que base legal
As bases legais abaixo foram **propostas a partir do funcionamento do sistema** e precisam ser **confirmadas pelo controlador**. O consentimento não é usado como justificativa genérica.
- **Criar e manter a sua conta e prestar o suporte** (abrir, atender e acompanhar chamados, falar com você pelos contatos informados): LGPD, art. 7º, V (execução de contrato ou procedimentos preliminares) [A CONFIRMAR].
- **Identificar com segurança quem solicita o acesso** (CPF e data de nascimento) e evitar cadastros duplicados ou indevidos: art. 7º, IX (legítimo interesse) [A VALIDAR a necessidade de cada dado].
- **Segurança, prevenção a fraudes e auditoria** (registros de acesso e de eventos de segurança, histórico dos chamados): art. 7º, II e IX, e art. 46; e a guarda de registros de acesso a aplicações prevista no Marco Civil da Internet (Lei nº 12.965/2014, art. 15), quando aplicável [A CONFIRMAR].
- **Avisos por e-mail sobre os chamados**: art. 7º, V e IX.
- **Relatórios e indicadores do atendimento** (volume, tempos e avaliações), feitos com os dados dos próprios chamados: art. 7º, IX.
- **Atender aos seus direitos e cumprir obrigações legais**: art. 7º, II.

## 5. Onde os dados ficam
- Banco de dados PostgreSQL em servidores próprios, em ambiente virtualizado operado por {{controlador}} [A DEFINIR: localização do data center e fornecedor da infraestrutura].
- O acesso pela internet é feito somente por conexão cifrada (HTTPS).
- Cópias de segurança (backup) diárias, com rodízio de cópias semanal, quinzenal, mensal, semestral e anual, guardadas com acesso restrito.

## 6. Quem acessa
- **Você:** os seus dados de cadastro e os seus chamados.
- **Gestores e coordenadores:** chamados das pessoas e unidades sob a sua responsabilidade.
- **Analistas e administradores:** dados necessários ao atendimento e à administração do sistema (cadastros, chamados, relatórios e registros de segurança).
- Equipe técnica que opera os servidores [A DEFINIR: quem e sob qual compromisso de confidencialidade].

## 7. Compartilhamento
- **Não vendemos nem compartilhamos dados pessoais para publicidade.** O sistema não usa ferramentas de análise de audiência, pixels, redes sociais ou rastreamento.
- **Envio de e-mails:** os avisos saem por um servidor de e-mail (SMTP) [A DEFINIR: provedor do serviço de e-mail], que recebe o endereço do destinatário e o texto do aviso.
- **IBGE:** a lista de municípios é obtida do serviço público de localidades do IBGE pelo nosso servidor; nenhum dado pessoal é enviado.
- Fontes, ícones e o QR Code do comprovante são gerados pelo próprio sistema, sem chamar serviços de terceiros.
- Dados podem ser fornecidos a autoridades quando houver obrigação legal ou ordem judicial.

## 8. Por quanto tempo guardamos
- **Conta e chamados:** enquanto o cadastro estiver ativo e pelo tempo necessário ao histórico do atendimento [A DEFINIR pelo controlador: prazo após a inativação].
- **Registros de acesso a aplicações:** no mínimo 6 meses, quando o Marco Civil da Internet se aplicar [A CONFIRMAR].
- **Registros de segurança, histórico dos chamados e registros de envio de e-mail:** hoje **não há exclusão automática** [A DEFINIR: prazo de retenção e descarte].
- **Aceites, ciências e solicitações de privacidade:** mantidos como comprovação do cumprimento da lei.
- **Cópias de segurança:** seguem o rodízio do item 5; um dado apagado do sistema pode permanecer nas cópias até elas serem substituídas.

## 9. Como protegemos
- Conexão cifrada (HTTPS), cabeçalhos de segurança no navegador e servidores atrás de proxy com acesso restrito.
- Senhas cifradas com algoritmo próprio para senhas (bcrypt), política de senha forte e bloqueio de reutilização.
- Sessão por token com validade limitada; perfil e situação da conta conferidos pelo servidor a cada requisição.
- Controle de acesso por perfil e por unidade, sempre validado no servidor.
- Limites de tentativas (login, cadastro, redefinição de senha e solicitações), registro de eventos de segurança e histórico dos chamados.
- Avisos por e-mail sem o conteúdo das mensagens.
- Cópias de segurança com acesso restrito.

## 10. Armazenamento no seu navegador (cookies e semelhantes)
O SuporteTI **não usa cookies de publicidade nem de rastreamento**. Usamos apenas o armazenamento local do navegador (localStorage e sessionStorage), sem enviar essas informações a terceiros:
- **Necessário:** o token da sua sessão (para manter você conectado) e a marcação de avisos já vistos.
- **Funcional:** preferências de tela (modo de visualização, filtros, quantidade de cards, período dos relatórios), rascunho de chamado ainda não enviado e uma cópia temporária de mensagens do chat, para a tela abrir mais rápido.
Ao clicar em **Sair**, a sessão é encerrada. Você pode apagar esses dados a qualquer momento nas configurações do navegador.

## 11. Seus direitos (LGPD, art. 18)
Você pode pedir: confirmação de que tratamos dados seus; acesso aos dados; correção de dados incompletos, inexatos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade; portabilidade; informação sobre com quem compartilhamos; e revisão de decisões.
- **Baixar meus dados:** em **Privacidade > Meus dados** você baixa na hora uma cópia dos seus dados de cadastro e dos seus chamados.
- **Solicitações:** em **Privacidade > Solicitações** você registra o pedido e recebe um **protocolo**. O pedido é analisado por pessoa responsável, que pode confirmar a sua identidade antes de atender.
- Nada é apagado automaticamente: dados sujeitos a guarda legal ou necessários à segurança e ao histórico do atendimento podem ter de ser mantidos, e você será informado da justificativa.
- Você também pode procurar a Autoridade Nacional de Proteção de Dados (ANPD).

## 12. Incidentes de segurança
Se suspeitar de acesso indevido à sua conta, perda de senha ou vazamento de dados, troque a sua senha e comunique imediatamente o encarregado ({{contato}}) ou registre uma solicitação em **Privacidade > Solicitações**. O controlador avalia a comunicação à ANPD e aos titulares nos prazos da regulamentação (Resolução CD/ANPD nº 15/2024).

## 13. Encarregado e contato
Encarregado pelo tratamento de dados pessoais: {{encarregado}}. Contato: {{contato}}.

## 14. Alterações desta Política
Cada alteração gera uma nova **versão**, com data de vigência. Quando houver nova versão, ela será apresentada para a sua ciência no próximo acesso.`;

const TERMOS = `## 1. O que é este termo
Regras para usar o SuporteTI. Ao se cadastrar e usar o sistema, você concorda em segui-las. O tratamento dos seus dados pessoais está descrito na Política de Privacidade.

## 2. Cadastro e acesso
- As informações do cadastro devem ser verdadeiras e mantidas atualizadas no seu Perfil.
- O acesso é liberado após análise do cadastro e pode ser limitado ao perfil e às unidades sob a sua responsabilidade.
- Login e senha são **pessoais e intransferíveis**. Não compartilhe a sua senha nem deixe outra pessoa usar o seu acesso.

## 3. Uso permitido
- Abrir e acompanhar chamados de suporte relacionados ao seu trabalho, com informações claras e verdadeiras.
- Conversar com a equipe de suporte com respeito e dentro da finalidade do atendimento.

## 4. Uso proibido
- Incluir **dados de pacientes** (nome, CPF, diagnósticos, exames ou outros dados de saúde) em chamados, mensagens ou anexos. Se precisar mostrar uma tela, oculte esses dados antes de anexar.
- Enviar arquivos com vírus, conteúdo ilegal, ofensivo ou que não tenha relação com o atendimento.
- Tentar acessar chamados, contas ou funções sem permissão, ou contornar os controles de segurança.
- Usar o sistema para fins pessoais ou alheios ao suporte técnico.

## 5. Registro e auditoria
Acessos, alterações de cadastro e de chamados e eventos de segurança são registrados (data/hora, usuário e IP) e podem ser auditados. Esses registros protegem você, a equipe e as unidades atendidas.

## 6. Responsabilidades e consequências
O descumprimento destes termos pode levar ao bloqueio do acesso, sem prejuízo das responsabilidades previstas em lei e em contrato. [A DEFINIR pelo jurídico: penalidades, foro e demais cláusulas contratuais.]

## 7. Disponibilidade
O sistema pode ficar indisponível para manutenção, atualizações ou por falhas técnicas. [A DEFINIR: níveis de serviço e canais alternativos de atendimento.]

## 8. Alterações
Estes termos podem ser atualizados. Cada alteração gera uma nova versão, apresentada para a sua ciência no próximo acesso.`;

export const PRIVACY_DOCUMENTS: readonly PrivacyDocument[] = [
  {
    type: "POLITICA_PRIVACIDADE",
    slug: "politica-de-privacidade",
    title: "Política de Privacidade",
    version: 1,
    effectiveDate: "2026-11-27",
    requiresAcknowledgement: true,
    legallyValidated: false,
    content: POLITICA,
  },
  {
    type: "TERMOS_USO",
    slug: "termos-de-uso",
    title: "Termos de Uso",
    version: 1,
    effectiveDate: "2026-11-27",
    requiresAcknowledgement: true,
    legallyValidated: false,
    content: TERMOS,
  },
];

export function hashPrivacyDocument(doc: Pick<PrivacyDocument, "title" | "content">): string {
  return createHash("sha256").update(`${doc.title}\n${doc.content}`, "utf8").digest("hex");
}

export function getPrivacyDocument(type: PrivacyDocumentType): PrivacyDocument | undefined {
  return PRIVACY_DOCUMENTS.find((d) => d.type === type);
}

/** Dados do controlador/encarregado vindos do .env (sem padrão: a tela mostra "a definir"). */
export function getPrivacyContacts(): { controller: string | null; dpoName: string | null; dpoEmail: string | null } {
  const clean = (v: string | undefined) => {
    const s = String(v ?? "").trim();
    return s ? s.slice(0, 200) : null;
  };
  return {
    controller: clean(process.env.PRIVACY_CONTROLLER),
    dpoName: clean(process.env.PRIVACY_DPO_NAME),
    dpoEmail: clean(process.env.PRIVACY_DPO_EMAIL),
  };
}

export const PRIVACY_REQUEST_TYPES = {
  CONFIRMACAO: "Confirmação de que meus dados são tratados",
  ACESSO: "Acesso aos meus dados",
  CORRECAO: "Correção de dados incompletos, inexatos ou desatualizados",
  ANONIMIZACAO_BLOQUEIO_ELIMINACAO: "Anonimização, bloqueio ou eliminação de dados",
  PORTABILIDADE: "Portabilidade dos dados",
  INFORMACAO_COMPARTILHAMENTO: "Informação sobre compartilhamento",
  REVISAO_DECISAO: "Revisão de decisão",
  OPOSICAO: "Oposição a um tratamento",
  INCIDENTE: "Comunicar suspeita de incidente de segurança",
  OUTRO: "Outro assunto de privacidade",
} as const;

export type PrivacyRequestType = keyof typeof PRIVACY_REQUEST_TYPES;

export const PRIVACY_REQUEST_STATUS = ["ABERTA", "EM_ANALISE", "CONCLUIDA", "INDEFERIDA"] as const;
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUS)[number];

/** Protocolo legível: PRV-AAAA-NNNNNN (sequência pelo id da solicitação). */
export function buildPrivacyProtocol(id: number, date: Date = new Date()): string {
  return `PRV-${date.getFullYear()}-${String(id).padStart(6, "0")}`;
}

/** Quais documentos o usuário ainda precisa aceitar/confirmar na versão vigente. */
export function pendingPrivacyDocuments(
  acceptedVersions: Partial<Record<PrivacyDocumentType, number>>,
): PrivacyDocument[] {
  return PRIVACY_DOCUMENTS.filter(
    (d) => d.requiresAcknowledgement && (acceptedVersions[d.type] ?? 0) < d.version,
  );
}
