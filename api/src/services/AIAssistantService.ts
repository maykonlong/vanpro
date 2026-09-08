// api/src/services/AIAssistantService.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class AIAssistantService {
  /**
   * Varre o banco de dados e gera os Posts de rascunho com base nas campanhas ativas.
   * Em produção, isso rodaria diariamente (Cron Job).
   */
  async generateDailyPosts(companyId: string) {
    console.log(`[AI-CRM] Iniciando varredura diária para a Frota ${companyId}...`);
    
    // 1. Buscar todas as campanhas ativas
    const campaigns = await prisma.aICampaign.findMany({
      where: { companyId, isActive: true }
    });

    const generatedPosts = [];

    // 2. Processar cada campanha
    for (const campaign of campaigns) {
      if (campaign.name.includes('Aniversário')) {
        // Encontrar alunos que fazem aniversário (Simulação: ignorar o ano)
        // No SQL real faríamos extract(month) = extract(month) e extract(day)
        const birthdayKids = await prisma.student.findMany({
          where: { 
            companyId, 
            dateOfBirth: { not: null },
            imageConsent: true // Apenas alunos autorizados
          }
        });

        for (const kid of birthdayKids) {
          // Mock da chamada da LLM
          const aiResponse = await this.callLLM(campaign.template, { 
            name: kid.name, 
            age: this.calculateAge(kid.dateOfBirth!) 
          });

          // Salvar o post como DRAFT
          const post = await prisma.aIPost.create({
            data: {
              companyId,
              campaignId: campaign.id,
              targetId: kid.id,
              channel: campaign.channel,
              status: 'DRAFT',
              content: aiResponse,
              imageUrl: kid.photoUrl // Sugere a foto do cadastro
            }
          });
          generatedPosts.push(post);
        }
      }
      
      if (campaign.name.includes('Cobrança')) {
        // Encontrar boletos vencendo amanha
        // Lógica simplificada
        const invoices = await prisma.invoice.findMany({
          where: { companyId, status: 'PENDING' },
          include: { student: true }
        });

        for (const invoice of invoices) {
          const aiResponse = await this.callLLM(campaign.template, { 
            name: invoice.student.name, 
            amount: invoice.amount 
          });

          const post = await prisma.aIPost.create({
            data: {
              companyId,
              campaignId: campaign.id,
              targetId: invoice.student.parentId,
              channel: 'WHATSAPP_PRIVATE',
              status: 'DRAFT',
              content: aiResponse,
            }
          });
          generatedPosts.push(post);
        }
      }
    }

    return generatedPosts;
  }

  /**
   * Simulador da API da OpenAI / Anthropic
   */
  private async callLLM(template: string, variables: any): Promise<string> {
    // Simulando latência da rede neural
    await new Promise(resolve => setTimeout(resolve, 800));

    if (template.includes('Aniversário')) {
      return `🎉 Hoje é um dia muito especial! Nosso querido passageiro ${variables.name} completa ${variables.age} anos de idade! Que o seu dia seja repleto de alegrias e brincadeiras. Parabéns da equipe VanPro! 🚐🎂`;
    }

    if (template.includes('Cobrança')) {
      return `Olá! Passando para lembrar com carinho que a mensalidade do(a) ${variables.name} no valor de R$ ${variables.amount} vence amanhã. Agradecemos a confiança no nosso transporte! 🚍`;
    }

    if (template.includes('Quebrou')) {
      return `🚨 [AVISO URGENTE] Prezada família, infelizmente nossa Van principal sofreu um imprevisto mecânico. Já estamos enviando o carro reserva, mas haverá um atraso de aproximadamente 30 minutos na rota de hoje. Pedimos desculpas pelo transtorno.`;
    }

    return "Mensagem gerada por IA baseada no template.";
  }

  private calculateAge(dob: Date): number {
    const diff = Date.now() - dob.getTime();
    const ageDt = new Date(diff); 
    return Math.abs(ageDt.getUTCFullYear() - 1970);
  }
}
