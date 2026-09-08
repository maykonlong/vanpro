import { Request, Response } from 'express';
import { prisma } from '../prisma';

export const getFinancialOverview = async (req: Request, res: Response) => {
  try {
    // Retorna o simulador do DRE baseado nas rotas (simplificado para MVP)
    const revenues = await prisma.student.aggregate({
      _sum: { monthlyFee: true }
    });
    
    // Calcula o custo da frota e salários
    const salaries = await prisma.driver.aggregate({
      _sum: { dailyRate: true } // Simplified
    });

    const dre = {
      totalRevenue: revenues._sum.monthlyFee || 0,
      totalExpenses: salaries._sum.dailyRate || 0,
      netProfit: (revenues._sum.monthlyFee || 0) - (salaries._sum.dailyRate || 0)
    };
    
    res.json(dre);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar dados financeiros' });
  }
};

export const generatePix = async (req: Request, res: Response) => {
  try {
    const { studentId } = req.body;
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) return res.status(404).json({ error: 'Aluno não encontrado' });

    // Integração mockada de gateway
    res.json({
      studentName: student.name,
      amount: student.monthlyFee,
      pixCode: `00020126580014BR.GOV.BCB.PIX...${studentId}`
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao gerar PIX' });
  }
};
