import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { logger } from '../utils/logger';

// 1. Download de Dados Pessoais (Takeout / Portabilidade)
export const exportData = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    // Apenas pais acessam este endpoint (para exportar os filhos)
    if (user.role !== 'PARENT') {
      return res.status(403).json({ error: "Acesso negado. Apenas os responsáveis legais podem exportar os dados brutos." });
    }

    // Coletar dados da Criança, Faturas (Asaas) e Presenças
    const students = await prisma.student.findMany({
      where: { parentId: user.id },
      include: {
        financials: true,
        invoices: true,
      }
    });

    const exportManifest = {
      generatedAt: new Date().toISOString(),
      requestedBy: user.email,
      legalDisclaimer: "Arquivo gerado em conformidade com o Artigo 18 da LGPD (Lei nº 13.709/2018) referente ao Direito de Portabilidade.",
      data: students
    };

    // Auditoria obrigatória (Quem puxou o relatório?)
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LGPD_DATA_EXPORT',
        description: `O responsável legal baixou um arquivo estruturado JSON com todos os dados dos dependentes.`
      }
    });

    // Enviar como anexo JSON
    res.setHeader('Content-disposition', 'attachment; filename=vanpro_lgpd_takeout.json');
    res.setHeader('Content-type', 'application/json');
    res.write(JSON.stringify(exportManifest, null, 2));
    res.end();
  } catch (error) {
    logger.error(`LGPD Export Error: ${(error as Error).message}`);
    res.status(500).json({ error: 'Erro ao gerar arquivo de portabilidade.' });
  }
};

// 2. Atualizar Conselhos de Imagem e LGPD (Self-Service)
export const updateConsents = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { studentId, imageConsent } = req.body;

    // Verificar se a criança pertence a esse pai
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    
    if (!student || student.parentId !== user.id) {
      return res.status(404).json({ error: 'Estudante não encontrado ou você não é o responsável.' });
    }

    const updated = await prisma.student.update({
      where: { id: studentId },
      data: { 
        imageConsent,
        consentDate: new Date()
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        companyId: student.companyId,
        action: 'LGPD_CONSENT_UPDATE',
        description: `Responsável legal alterou a permissão de Imagem da criança para: ${imageConsent}`
      }
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar consentimento.' });
  }
};

// 3. O Gatilho do Direito ao Esquecimento (Aprovação do Gestor)
export const requestForgetMe = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { studentId } = req.body;

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student || student.parentId !== user.id) {
      return res.status(404).json({ error: 'Estudante não encontrado ou você não tem permissão.' });
    }

    // Sinalizar o banco para o Gestor aprovar a exclusão permanente (evita calote)
    await prisma.student.update({
      where: { id: studentId },
      data: { deleteRequestStatus: 'PENDING_APPROVAL' }
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        companyId: student.companyId,
        action: 'LGPD_FORGET_REQUEST',
        description: `Pai acionou o Direito ao Esquecimento (Art. 18, VI da LGPD). Aguardando verificação de pendências pelo gestor.`
      }
    });

    res.json({ 
      success: true, 
      message: "Sua solicitação de exclusão permanente foi enviada. Por questões fiscais, o gestor irá confirmar se não há boletos em aberto antes de executar a limpeza irreversível do banco de dados." 
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao solicitar exclusão.' });
  }
};
