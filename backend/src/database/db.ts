export interface Vehicle {
  id: string;
  name: string;
  plate: string;
  model: string;
  capacity: number;
  currentKm: number;
  avgKmPerLiter: number;
  driver: string;
  status: string;
}

export interface Student {
  id: string;
  name: string;
  school: string;
  grade: string;
  time: string;
  status: 'BOARDED' | 'ABSENT' | 'PENDING';
  address: string;
  phone: string;
  monthlyFee: number;
}

export interface FinancialTransaction {
  id: string;
  vehicleId: string;
  type: 'INCOME' | 'EXPENSE';
  category: string;
  description: string;
  amount: number;
  referenceMonth: string;
  paid: boolean;
}

class VanProDatabase {
  public vehicles: Vehicle[] = [
    { id: 'van01', name: 'Van 01 - Ford Transit 2024', plate: 'ABC-1D23', model: 'Ford Transit Executive', capacity: 15, currentKm: 42800, avgKmPerLiter: 8.8, driver: 'Carlos Oliveira', status: 'Em Rota' },
    { id: 'van02', name: 'Van 02 - Mercedes Sprinter', plate: 'XYZ-9E87', model: 'Mercedes-Benz Sprinter 516', capacity: 19, currentKm: 78500, avgKmPerLiter: 7.9, driver: 'Pedro Santos', status: 'Livre / Frete' },
    { id: 'van03', name: 'Van 03 - Renault Master', plate: 'KRM-4F55', model: 'Renault Master Minibus', capacity: 16, currentKm: 112000, avgKmPerLiter: 8.2, driver: 'Marcos Lima', status: 'Revisão' },
  ];

  public students: Student[] = [
    { id: 'st1', name: 'João Rodrigues', school: 'Colégio Dom Pedro II', grade: '6º Ano A', time: '06:30', status: 'BOARDED', address: 'Rua Haddock Lobo, 400', phone: '(11) 96666-4004', monthlyFee: 580 },
    { id: 'st2', name: 'Ana Rodrigues', school: 'Colégio Dom Pedro II', grade: '3º Ano B', time: '06:32', status: 'BOARDED', address: 'Rua Haddock Lobo, 400', phone: '(11) 96666-4004', monthlyFee: 520 },
    { id: 'st3', name: 'Pedro Henrique Lima', school: 'Escola Santa Catarina', grade: '7º Ano C', time: '06:45', status: 'PENDING', address: 'Rua Bela Cintra, 950', phone: '(11) 95555-3333', monthlyFee: 600 },
    { id: 'st4', name: 'Beatriz Santos', school: 'Colégio Dom Pedro II', grade: '5º Ano A', time: '06:52', status: 'ABSENT', address: 'Alameda Santos, 1200', phone: '(11) 94444-2222', monthlyFee: 550 },
  ];

  public transactions: FinancialTransaction[] = [
    { id: 'tx1', vehicleId: 'van01', type: 'INCOME', category: 'MONTHLY_FEE', description: 'Mensalidades Escolares Van 01 (42 Alunos)', amount: 14800, referenceMonth: '2026-09', paid: true },
    { id: 'tx2', vehicleId: 'van02', type: 'INCOME', category: 'FREIGHT_REVENUE', description: 'Frete Fim de Semana - Viagem Campos do Jordão', amount: 2400, referenceMonth: '2026-09', paid: true },
    { id: 'tx3', vehicleId: 'van01', type: 'EXPENSE', category: 'FUEL', description: 'Abastecimentos Diesel S10 - Van 01', amount: 2150, referenceMonth: '2026-09', paid: true },
    { id: 'tx4', vehicleId: 'van01', type: 'EXPENSE', category: 'MAINTENANCE', description: 'Troca de Óleo e Filtros Van 01', amount: 650, referenceMonth: '2026-09', paid: true },
    { id: 'tx5', vehicleId: 'van01', type: 'EXPENSE', category: 'SALARY', description: 'Salário Motorista Carlos', amount: 3500, referenceMonth: '2026-09', paid: true },
    { id: 'tx6', vehicleId: 'van01', type: 'EXPENSE', category: 'INSURANCE', description: 'Seguro Mensal Frota Van 01', amount: 420, referenceMonth: '2026-09', paid: false },
  ];

  public updateStudentStatus(studentId: string, status: 'BOARDED' | 'ABSENT' | 'PENDING') {
    const student = this.students.find(s => s.id === studentId);
    if (student) {
      student.status = status;
    }
    return student;
  }

  public getDre(vehicleId?: string) {
    const filtered = vehicleId && vehicleId !== 'ALL'
      ? this.transactions.filter(t => t.vehicleId === vehicleId)
      : this.transactions;

    const totalIncome = filtered.filter(t => t.type === 'INCOME').reduce((acc, t) => acc + t.amount, 0);
    const totalExpense = filtered.filter(t => t.type === 'EXPENSE').reduce((acc, t) => acc + t.amount, 0);
    const netProfit = totalIncome - totalExpense;
    const margin = totalIncome > 0 ? Number(((netProfit / totalIncome) * 100).toFixed(1)) : 0;

    return {
      totalIncome,
      totalExpense,
      netProfit,
      margin,
    };
  }
}

export const db = new VanProDatabase();
