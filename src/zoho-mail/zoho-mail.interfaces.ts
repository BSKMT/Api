/**
 * Tipos e interfaces de la integracion con Zoho Mail API.
 *
 * Define las estructuras de peticion/respuesta para el envio de correos
 * a traves del endpoint POST /api/accounts/{accountId}/messages y el
 * flujo de refresco del token OAuth 2.0 de Zoho.
 */

/**
 * Parametros para enviar un correo a traves de Zoho Mail.
 * Los campos marcados como obligatorios corresponden a los requisitos
 * del endpoint de Zoho Mail "Send an Email".
 */
export interface ZohoSendEmailParams {
  /** Direccion remitente (debe corresponder a la cuenta autenticada). */
  fromAddress: string;
  /** Direccion(es) destinatarias, separadas por coma si son varias. */
  toAddress: string;
  /** Direcciones en copia, separadas por coma (opcional). */
  ccAddress?: string;
  /** Direcciones en copia oculta, separadas por coma (opcional). */
  bccAddress?: string;
  /** Asunto del correo. */
  subject: string;
  /** Contenido del correo (HTML o texto plano segun `mailFormat`). */
  content: string;
  /** Formato del contenido: "html" (default) o "plaintext". */
  mailFormat?: "html" | "plaintext";
  /** Solicitar confirmacion de lectura: "yes" | "no" (opcional). */
  askReceipt?: "yes" | "no";
  /** Codificacion del contenido (default UTF-8). */
  encoding?: string;
}

/**
 * Respuesta exitosa del envio de un correo segun la documentacion de Zoho.
 */
export interface ZohoSendEmailResponse {
  status: {
    code: number;
    description: string;
  };
  data: {
    subject?: string;
    messageId?: string;
    fromAddress?: string;
    mailId?: string;
    toAddress?: string;
    content?: string;
    moreInfo?: string;
  };
}

/**
 * Respuesta del refresco del token de acceso de Zoho Accounts.
 */
export interface ZohoTokenResponse {
  access_token: string;
  expires_in: number;
  api_domain?: string;
  token_type: string;
}

/**
 * Resultado normalizado del envio de un correo.
 * Permite que el consumidor reaccione sin acoplarse a la respuesta cruda.
 */
export interface ZohoMailResult {
  ok: boolean;
  code: number;
  message: string;
  messageId?: string;
}
