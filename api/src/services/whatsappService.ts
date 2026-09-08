import { logger } from '../utils/logger';

/**
 * INTEGRAÇÃO WHATSAPP (BAILEYS / EVOLUTION API)
 * Devido ao peso de instanciar o Baileys no mesmo servidor HTTP (WebSockets pesados),
 * a arquitetura ideal para Multi-Tenancy é delegar para um micro-serviço (ou serviço gerenciado como Evolution API).
 * 
 * Este serviço atua como uma ponte (Interface) que será chamada pela nossa fila do Redis.
 */
export const sendWhatsappMessage = async (companyId: string, phone: string, message: string) => {
  logger.info(`💬 [Company: ${companyId}] Disparando WhatsApp para ${phone}: ${message.substring(0, 20)}...`);

  // Em produção, isso faria uma chamada HTTP para a API de mensageria 
  // Exemplo (Evolution API / Chatwoot):
  /*
  const companySession = await prisma.company.findUnique({ where: { id: companyId }});
  await axios.post(`${process.env.WHATSAPP_API_URL}/message/sendText/${companySession.instanceName}`, {
    number: phone,
    text: message
  }, { headers: { 'apikey': process.env.WHATSAPP_API_KEY } });
  */

  return true;
};
