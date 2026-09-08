// api/src/services/AsaasService.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || null;
const ASAAS_URL = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';

export class AsaasService {
  /**
   * Gera uma cobrança Pix no Asaas para a mensalidade de um aluno
   */
  async createPixCharge(studentId: string, amount: number, dueDate: string) {
    if (!ASAAS_API_KEY) {
      console.warn('⚠️ [ASAAS_MOCK] ASAAS_API_KEY não encontrada. Simulando geração de Pix no Banco de Dados...');
      
      const fakeGatewayId = `simulated_pay_${Date.now()}`;
      
      // Simulação: Apenas salva no DB como se tivesse batido na API
      const invoice = await prisma.invoice.create({
        data: {
          companyId: 'mock-company', // Num fluxo real, pegaríamos o companyId do student
          studentId,
          amount,
          dueDate: new Date(dueDate),
          gatewayId: fakeGatewayId,
          paymentUrl: `https://simulated-bank.com/pix/${fakeGatewayId}`
        }
      });
      return invoice;
    }

    console.log(`🔌 Chamando API Real do Asaas para gerar cobrança de R$ ${amount}...`);
    
    // Implementação Oficial Asaas (Aguardando Chave Prod)
    try {
      const response = await fetch(`${ASAAS_URL}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access_token': ASAAS_API_KEY
        },
        body: JSON.stringify({
          customer: "cus_000005030283", // ID do cliente no Asaas (deve ser criado antes)
          billingType: "PIX",
          value: amount,
          dueDate: dueDate,
          description: "Mensalidade Escolar VanPro"
        })
      });

      if (!response.ok) throw new Error("Erro na API do Asaas");
      
      const asaasData = await response.json();

      return await prisma.invoice.create({
        data: {
          companyId: 'mock-company', 
          studentId,
          amount,
          dueDate: new Date(dueDate),
          gatewayId: asaasData.id,
          paymentUrl: asaasData.invoiceUrl // Link real do boleto/pix
        }
      });
    } catch (error) {
      console.error('Erro ao integrar com Asaas:', error);
      throw error;
    }
  }

  /**
   * Endpoint consumido pelo Webhook do Asaas
   * Quando o pai paga o Pix, o Asaas avisa essa rota.
   */
  async processWebhook(eventBody: any) {
    if (eventBody.event === 'PAYMENT_RECEIVED') {
      const paymentId = eventBody.payment.id;
      
      console.log(`✅ Webhook Asaas: Pagamento ${paymentId} confirmado! Baixando no DRE...`);
      
      // 1. Atualizar Fatura
      const invoice = await prisma.invoice.updateMany({
        where: { gatewayId: paymentId },
        data: { status: 'RECEIVED' }
      });

      // 2. Gerar entrada no DRE
      // (Em produção, precisaríamos buscar o invoiceId exato para atrelar a transação ao Student)
      
      return { success: true, message: 'Baixa processada automaticamente' };
    }
  }
}
