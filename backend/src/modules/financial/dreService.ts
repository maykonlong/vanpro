import { prisma } from '../../config/database';

export class DreService {
  static async getDreReport(tenantId: string, referenceMonth: string, vehicleId?: string) {
    const whereClause: any = {
      tenantId,
      referenceMonth,
    };

    if (vehicleId) {
      whereClause.vehicleId = vehicleId;
    }

    const transactions = await prisma.financialTransaction.findMany({
      where: whereClause,
      include: {
        vehicle: { select: { id: true, name: true, plate: true } },
      },
    });

    let totalIncome = 0;
    let totalExpense = 0;

    const incomeByCategory: Record<string, number> = {};
    const expenseByCategory: Record<string, number> = {};

    transactions.forEach((tx) => {
      const amount = Number(tx.amount);
      if (tx.type === 'INCOME') {
        totalIncome += amount;
        incomeByCategory[tx.category] = (incomeByCategory[tx.category] || 0) + amount;
      } else {
        totalExpense += amount;
        expenseByCategory[tx.category] = (expenseByCategory[tx.category] || 0) + amount;
      }
    });

    const netMargin = totalIncome - totalExpense;
    const marginPercentage = totalIncome > 0 ? Number(((netMargin / totalIncome) * 100).toFixed(1)) : 0;

    return {
      referenceMonth,
      vehicleId: vehicleId || 'TODAS_AS_VANS',
      totalIncome,
      totalExpense,
      netMargin,
      marginPercentage,
      incomeBreakdown: incomeByCategory,
      expenseBreakdown: expenseByCategory,
      status: netMargin >= 0 ? 'LUCRO' : 'PREJUIZO',
    };
  }
}
