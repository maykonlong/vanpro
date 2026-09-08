// api/src/services/WhatsAppService.ts
const META_WHATSAPP_TOKEN = process.env.META_WHATSAPP_TOKEN || null;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID || 'mock_phone_id';

export class WhatsAppService {
  /**
   * Dispara uma mensagem via Meta Cloud API para o WhatsApp de um Pai/Responsável
   */
  async sendMessage(toPhone: string, message: string) {
    if (!META_WHATSAPP_TOKEN) {
      console.warn(`⚠️ [WHATSAPP_MOCK] Simulando envio de mensagem para ${toPhone}:\n"${message}"`);
      return { success: true, mock: true, messageId: `mock_wamid_${Date.now()}` };
    }

    console.log(`💬 Disparando mensagem real via WhatsApp Business API para ${toPhone}...`);

    try {
      const response = await fetch(`https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${META_WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toPhone.replace(/\D/g, ''), // Limpa máscara
          type: "text",
          text: {
            body: message
          }
        })
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(`WhatsApp API Error: ${data.error.message}`);
      }

      return {
        success: true,
        mock: false,
        messageId: data.messages?.[0]?.id
      };
    } catch (error) {
      console.error('Falha ao enviar WhatsApp:', error);
      throw error;
    }
  }

  /**
   * Disparo em Lote para Emergências (Ex: Van Quebrou)
   */
  async broadcastEmergency(phones: string[], emergencyMessage: string) {
    console.log(`🚨 Iniciando Broadcast de Emergência para ${phones.length} famílias...`);
    const results = [];
    for (const phone of phones) {
      const res = await this.sendMessage(phone, emergencyMessage);
      results.push(res);
      // Evitar Rate Limit da API do WhatsApp
      await new Promise(r => setTimeout(r, 100)); 
    }
    return results;
  }
}
