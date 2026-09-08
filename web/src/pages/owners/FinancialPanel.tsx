import React, { useState, useEffect } from 'react';
import { DollarSign, CheckCircle2, XCircle, FileText, ArrowDownCircle, ArrowUpCircle, Wallet, Plus, GasPump, Wrench, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

type Transaction = { id: string; student: { name: string }; amount: number; paid: boolean; dueDate: string; };
type Expense = { id: string; description: string; amount: number; category: string; date: string; };

export const FinancialPanel: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'RECEIVABLES' | 'EXPENSES'>('RECEIVABLES');
  const [incomes, setIncomes] = useState<Transaction[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  // Mock Data Fetching
  useEffect(() => {
    setTimeout(() => {
      setIncomes([
        { id: '1', student: { name: 'Joãozinho Silva' }, amount: 450, paid: true, dueDate: '2026-09-10T00:00:00Z' },
        { id: '2', student: { name: 'Ana Souza' }, amount: 380, paid: false, dueDate: '2026-09-10T00:00:00Z' },
        { id: '3', student: { name: 'Carlos Neto' }, amount: 500, paid: true, dueDate: '2026-09-15T00:00:00Z' },
      ]);
      setExpenses([
        { id: '10', description: 'Diesel S10 - Van 1', amount: 350, category: 'FUEL', date: '2026-09-08T10:00:00Z' },
        { id: '11', description: 'Troca de Óleo', amount: 200, category: 'MAINTENANCE', date: '2026-09-07T14:00:00Z' },
        { id: '12', description: 'Diária Motorista João', amount: 150, category: 'PAYROLL', date: '2026-09-06T18:00:00Z' },
      ]);
      setLoading(false);
    }, 1000);
  }, []);

  if (user?.role !== 'OWNER' && user?.role !== 'SUPER_ADMIN') {
    return <div className="p-8 text-red-500 font-bold">Acesso restrito ao Administrador Financeiro.</div>;
  }

  const totalIncome = incomes.filter(i => i.paid).reduce((acc, curr) => acc + curr.amount, 0);
  const totalPending = incomes.filter(i => !i.paid).reduce((acc, curr) => acc + curr.amount, 0);
  const totalExpense = expenses.reduce((acc, curr) => acc + curr.amount, 0);
  const netProfit = totalIncome - totalExpense;

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'FUEL': return <GasPump className="w-5 h-5 text-blue-400" />;
      case 'MAINTENANCE': return <Wrench className="w-5 h-5 text-orange-400" />;
      case 'PAYROLL': return <User className="w-5 h-5 text-purple-400" />;
      default: return <FileText className="w-5 h-5 text-slate-400" />;
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <div className="flex items-center gap-3">
        <Wallet className="w-8 h-8 text-amber-500" />
        <h1 className="text-3xl font-bold text-white">Fluxo de Caixa (DRE)</h1>
      </div>

      {/* DRE Cards */}
      <div className="grid md:grid-cols-4 gap-6">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
          <div className="flex justify-between items-start mb-2">
            <span className="text-slate-400 font-medium">Entradas (Pagas)</span>
            <ArrowUpCircle className="text-emerald-500 w-5 h-5" />
          </div>
          <div className="text-2xl font-bold text-white">R$ {totalIncome.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
          <div className="flex justify-between items-start mb-2">
            <span className="text-slate-400 font-medium">Saídas (Despesas)</span>
            <ArrowDownCircle className="text-red-500 w-5 h-5" />
          </div>
          <div className="text-2xl font-bold text-white">R$ {totalExpense.toFixed(2)}</div>
        </div>
        <div className="bg-gradient-to-br from-amber-500 to-amber-600 p-6 rounded-3xl text-slate-950">
          <div className="flex justify-between items-start mb-2">
            <span className="font-bold opacity-80">Lucro Líquido</span>
            <DollarSign className="w-5 h-5" />
          </div>
          <div className="text-3xl font-black">R$ {netProfit.toFixed(2)}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl border-dashed">
          <div className="flex justify-between items-start mb-2">
            <span className="text-slate-400 font-medium">A Receber</span>
            <XCircle className="text-amber-500 w-5 h-5" />
          </div>
          <div className="text-2xl font-bold text-slate-300">R$ {totalPending.toFixed(2)}</div>
        </div>
      </div>

      {/* Navigation & Controls */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-800">
          <button 
            onClick={() => setActiveTab('RECEIVABLES')}
            className={`px-6 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'RECEIVABLES' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-400 hover:text-white'}`}
          >
            Entradas (Asaas)
          </button>
          <button 
            onClick={() => setActiveTab('EXPENSES')}
            className={`px-6 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === 'EXPENSES' ? 'bg-red-500/20 text-red-400' : 'text-slate-400 hover:text-white'}`}
          >
            Saídas (Despesas)
          </button>
        </div>

        {activeTab === 'EXPENSES' && (
          <button className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-6 py-3 rounded-xl flex items-center gap-2 transition-colors">
            <Plus className="w-5 h-5" /> Nova Despesa
          </button>
        )}
      </div>

      {/* Tables Area */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden min-h-[400px]">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Processando faturas...</div>
        ) : activeTab === 'RECEIVABLES' ? (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950/50 text-slate-400 text-sm">
                <th className="p-6 font-medium">Aluno / Cliente</th>
                <th className="p-6 font-medium">Vencimento</th>
                <th className="p-6 font-medium">Valor</th>
                <th className="p-6 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {incomes.map(t => (
                <tr key={t.id} className="border-t border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                  <td className="p-6 text-white font-medium">{t.student.name}</td>
                  <td className="p-6 text-slate-400">{new Date(t.dueDate).toLocaleDateString()}</td>
                  <td className="p-6 font-mono text-emerald-400 font-bold">R$ {t.amount.toFixed(2)}</td>
                  <td className="p-6">
                    {t.paid ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full"><CheckCircle2 className="w-3 h-3" /> PAGO</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-400 bg-amber-400/10 px-3 py-1 rounded-full"><XCircle className="w-3 h-3" /> PENDENTE</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950/50 text-slate-400 text-sm">
                <th className="p-6 font-medium">Categoria</th>
                <th className="p-6 font-medium">Descrição</th>
                <th className="p-6 font-medium">Data</th>
                <th className="p-6 font-medium">Valor Negativo</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map(e => (
                <tr key={e.id} className="border-t border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                  <td className="p-6 flex items-center gap-3">
                    <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">{getCategoryIcon(e.category)}</div>
                    <span className="text-xs font-bold text-slate-400">{e.category}</span>
                  </td>
                  <td className="p-6 text-white">{e.description}</td>
                  <td className="p-6 text-slate-400">{new Date(e.date).toLocaleDateString()}</td>
                  <td className="p-6 font-mono text-red-400 font-bold">- R$ {e.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default FinancialPanel;
