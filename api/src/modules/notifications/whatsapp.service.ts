import { env, features } from '../../config/env';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';

/**
 * WhatsApp Business (Cloud API).
 *
 * Sem credencial a funcao LANCA. A versao anterior "simulava o envio" e
 * devolvia sucesso: o painel mostrava a mensagem entregue, a mae nunca recebeu
 * o aviso de que a van atrasou, e ninguem tinha como saber a diferenca.
 * Ausencia de integracao vira 503 FEATURE_DISABLED, nunca um `true` educado.
 */

const GRAPH_VERSION = 'v21.0';
const TIMEOUT_MS = 10_000;

export interface SendResult {
  toMasked: string;
  messageId: string;
}

/**
 * Numero em log so aparece pelos 4 ultimos digitos: telefone e dado pessoal
 * (LGPD Art. 5) e log de aplicacao vaza mais do que endpoint mal feito.
 */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 4 ? '****' : `****${digits.slice(-4)}`;
}

/** E.164 sem sinais: a Graph API recusa numero formatado. */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    throw Errors.validation([{ campo: 'phone', erro: 'Telefone inválido para envio no WhatsApp' }]);
  }
  return digits;
}

function assertEnabled(): { token: string; phoneId: string } {
  if (!features.whatsapp || !env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    throw Errors.featureDisabled('WhatsApp Business');
  }
  return { token: env.WHATSAPP_TOKEN, phoneId: env.WHATSAPP_PHONE_ID };
}

export async function sendMessage(toPhone: string, message: string): Promise<SendResult> {
  const { token, phoneId } = assertEnabled();
  const to = normalizePhone(toPhone);
  const masked = maskPhone(to);

  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { preview_url: false, body: message },
      }),
      // Sem timeout, o provedor fora do ar segura o handler ate o socket cair e
      // um pico de envio consome o pool de conexoes da API inteira.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.error({ err, to: masked }, 'falha de rede ao chamar a API do WhatsApp');
    throw Errors.internal('Falha de comunicação com o WhatsApp Business.');
  }

  if (!response.ok) {
    // Corpo da resposta so no log: ele carrega detalhe da conta e do token.
    const detail = await response.text().catch(() => '');
    logger.error({ status: response.status, to: masked, detail }, 'WhatsApp recusou o envio');
    throw Errors.internal('O WhatsApp Business recusou o envio.');
  }

  const body = (await response.json().catch(() => null)) as
    | { messages?: Array<{ id?: string }> }
    | null;
  const messageId = body?.messages?.[0]?.id;

  if (!messageId) {
    // Resposta 200 sem id nao prova entrega. Tratar como sucesso seria repetir
    // o defeito antigo em outra camada.
    logger.error({ to: masked }, 'WhatsApp respondeu sem id de mensagem');
    throw Errors.internal('O WhatsApp Business não confirmou o envio.');
  }

  logger.info({ to: masked, messageId }, 'mensagem enviada pelo WhatsApp');
  return { toMasked: masked, messageId };
}

export interface BroadcastResult {
  sent: number;
  failed: number;
  results: Array<{ toMasked: string; ok: boolean; messageId?: string }>;
}

/**
 * Envio em lote, sequencial e tolerante a falha individual.
 *
 * Sequencial de proposito: a Cloud API limita taxa por numero, e disparar tudo
 * em paralelo troca "duas mensagens atrasadas" por "conta bloqueada".
 * O resultado diz quantas falharam — lote que erra em silencio e o mesmo
 * problema do envio simulado.
 */
export async function broadcast(phones: string[], message: string): Promise<BroadcastResult> {
  assertEnabled();

  const results: BroadcastResult['results'] = [];
  let sent = 0;
  let failed = 0;

  for (const phone of phones) {
    try {
      const r = await sendMessage(phone, message);
      results.push({ toMasked: r.toMasked, ok: true, messageId: r.messageId });
      sent += 1;
    } catch (err) {
      const masked = maskPhone(phone);
      logger.warn({ err, to: masked }, 'destinatário do broadcast falhou');
      results.push({ toMasked: masked, ok: false });
      failed += 1;
    }
  }

  return { sent, failed, results };
}
