import React, { useState, useEffect } from 'react';
import { Wallet, Calendar, DollarSign, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Tooltip } from '../../components/Tooltip';

type Earnings = {
  id: string;
  description: string;
  amount: number;
  date: string;
};

export const MyEarnings: React.FC = () => {
  const { user } = useAuth();
  const [earnings, setEarnings] = useState<Earnings[]>([]);
  const [loading, setLoading] = useState(true);

  // Mock de repasses/salário do mês
  useEffect(() => {
    setTimeout(() => {
      setEarnings([
        { id: '1', description: 'Diária Cobrindo Rota Norte', amount: 150, date: '2026-09-08T18:00:00Z' },
        { id: '2', description: 'Diária Cobrindo Rota Sul', amount: 150, date: '2026-09-07T18:00:00Z' },
        { id: '3', description: 'Bônus Extra', amount: 50, date: '2026-09-07T19:00:00Z' },
      ]);
      setLoading(false);
    }, 1000);
  }, []);

  if (user?.role !== 'DRIVER' && user?.role !== 'ASSISTANT') {
    return <div className="p-8 text-red-500 font-bold">Esta tela é exclusiva para funcionários da frota.</div>;
  }

  const totalEarned = earnings.reduce((acc, curr) => acc + curr.amount, 0);

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Wallet className="w-8 h-8 text-amber-500" />
          <h1 className="text-3xl font-bold text-white">Meus Ganhos</h1>
        </div>
      </div>

      <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-3xl p-8 text-slate-950 shadow-[0_0_40px_rgba(245,158,11,0.15)] flex flex-col md:flex-row justify-between items-center gap-6">
        <div>
          <h2 className="font-bold opacity-80 flex items-center gap-2 mb-2">
            <Calendar className="w-5 h-5"/> Total Recebido neste Mês
            <Tooltip content="Valor acumulado de todas as diárias, salários ou bonificações recebidas nos últimos 30 dias." />
          </h2>
          <div className="text-5xl font-black tracking-tight">R$ {totalEarned.toFixed(2)}</div>
        </div>
        <div className="bg-slate-950/10 px-6 py-4 rounded-2xl backdrop-blur-sm border border-slate-950/10 flex items-center gap-4">
          <Clock className="w-6 h-6" />
          <div className="text-sm font-medium">Os repasses aparecem aqui <br/>assim que o Dono da Frota registrar.</div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white">Extrato de Pagamentos</h2>
        </div>
        
        {loading ? (
          <div className="p-12 text-center text-slate-400">Carregando seus repasses...</div>
        ) : earnings.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Nenhum repasse registrado neste mês.</div>
        ) : (
          <div className="divide-y divide-slate-800/50">
            {earnings.map(e => (
              <div key={e.id} className="p-6 hover:bg-slate-800/30 transition-colors flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="bg-emerald-500/10 p-3 rounded-xl">
                    <DollarSign className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-lg">{e.description}</h3>
                    <span className="text-slate-400 text-sm">{new Date(e.date).toLocaleString()}</span>
                  </div>
                </div>
                <div className="text-xl font-black text-emerald-400 font-mono">
                  + R$ {e.amount.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyEarnings;
