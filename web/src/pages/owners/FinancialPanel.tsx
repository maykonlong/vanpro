import React, { useState, useEffect } from 'react';
import { DollarSign, CheckCircle2, XCircle, Search, FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

type Transaction = {
  id: string;
  student: { name: string };
  amount: number;
  paid: boolean;
  externalId: string;
  dueDate: string;
};

export const FinancialPanel: React.FC = () => {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Mocking para MVP visual (No real cenário, fariamos o fetch)
  useEffect(() => {
    setTimeout(() => {
      setTransactions([
        { id: '1', student: { name: 'Joãozinho Silva' }, amount: 450, paid: true, externalId: 'PIX_123', dueDate: '2026-09-10T00:00:00Z' },
        { id: '2', student: { name: 'Ana Souza' }, amount: 380, paid: false, externalId: 'PIX_456', dueDate: '2026-09-10T00:00:00Z' },
      ]);
      setLoading(false);
    }, 1000);
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2 text-white">
          <DollarSign className="text-emerald-400" /> Controle Financeiro (Asaas)
        </h1>
        <div className="bg-slate-900 p-2 rounded-xl flex items-center gap-2 border border-slate-800">
          <Search className="w-4 h-4 text-slate-400 ml-2" />
          <input 
            type="text" 
            placeholder="Buscar aluno..." 
            className="bg-transparent border-none outline-none text-white w-48 text-sm"
          />
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Carregando faturas...</div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 text-sm">
                <th className="p-4 font-medium">Aluno</th>
                <th className="p-4 font-medium">Vencimento</th>
                <th className="p-4 font-medium">Valor</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors text-white">
                  <td className="p-4 font-medium">{t.student.name}</td>
                  <td className="p-4 text-slate-400">{new Date(t.dueDate).toLocaleDateString()}</td>
                  <td className="p-4 font-mono text-emerald-400">R$ {t.amount.toFixed(2)}</td>
                  <td className="p-4">
                    {t.paid ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> PAGO (PIX)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-400 bg-amber-400/10 px-3 py-1 rounded-full">
                        <XCircle className="w-3 h-3" /> PENDENTE
                      </span>
                    )}
                  </td>
                  <td className="p-4 text-right">
                    {!t.paid && (
                      <button className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ml-auto">
                        <FileText className="w-4 h-4" /> Ver Fatura
                      </button>
                    )}
                  </td>
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
