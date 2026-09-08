import React, { useState, useEffect } from 'react';
import { ShieldAlert, TrendingUp, Users, Smartphone, Key } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

type Tenant = {
  id: string;
  name: string;
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  vehiclesCount: number;
  revenue: number;
  whatsappConnected: boolean;
};

export const MasterDashboard: React.FC = () => {
  const { user } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);

  // Mocking visual para o Painel Mestre
  useEffect(() => {
    setTenants([
      { id: '1', name: 'Tio Paulinho Vans', plan: 'PRO', vehiclesCount: 3, revenue: 199.90, whatsappConnected: true },
      { id: '2', name: 'Tia Rosa Transporte', plan: 'FREE', vehiclesCount: 1, revenue: 0, whatsappConnected: false },
      { id: '3', name: 'Logística Escolar Alfa', plan: 'ENTERPRISE', vehiclesCount: 12, revenue: 599.90, whatsappConnected: true },
    ]);
  }, []);

  if (user?.role !== 'SUPER_ADMIN') {
    return <div className="text-red-500 font-bold p-8">ACESSO NEGADO: Apenas Administradores Master podem ver esta tela.</div>;
  }

  const mrr = tenants.reduce((acc, t) => acc + t.revenue, 0);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-2 text-white">
          <ShieldAlert className="text-purple-500 w-8 h-8" /> SaaS Master Control
        </h1>
        <div className="flex gap-4">
          <div className="bg-purple-500/20 text-purple-400 font-bold px-6 py-3 rounded-xl border border-purple-500/50 flex flex-col items-end">
            <span className="text-xs uppercase tracking-wider text-purple-300">Receita Recorrente (MRR)</span>
            <span className="text-xl">R$ {mrr.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
          <TrendingUp className="text-emerald-400 w-8 h-8 mb-4" />
          <p className="text-slate-400 text-sm">Empresas Ativas</p>
          <p className="text-white font-bold text-2xl">{tenants.length}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
          <Users className="text-blue-400 w-8 h-8 mb-4" />
          <p className="text-slate-400 text-sm">Total de Motoristas SaaS</p>
          <p className="text-white font-bold text-2xl">45</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
          <Smartphone className="text-emerald-400 w-8 h-8 mb-4" />
          <p className="text-slate-400 text-sm">Instâncias WhatsApp</p>
          <p className="text-white font-bold text-2xl">{tenants.filter(t => t.whatsappConnected).length}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
          <Key className="text-amber-400 w-8 h-8 mb-4" />
          <p className="text-slate-400 text-sm">Licenças Disponíveis</p>
          <p className="text-white font-bold text-2xl">Ilimitado</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 text-sm">
              <th className="p-4 font-medium">Empresa de Van (Tenant)</th>
              <th className="p-4 font-medium">Plano</th>
              <th className="p-4 font-medium">Frota</th>
              <th className="p-4 font-medium">Faturamento SaaS</th>
              <th className="p-4 font-medium">WhatsApp</th>
              <th className="p-4 font-medium text-right">Controle</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map(t => (
              <tr key={t.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 text-white">
                <td className="p-4 font-bold">{t.name}</td>
                <td className="p-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${t.plan === 'PRO' ? 'bg-purple-500/20 text-purple-400' : t.plan === 'ENTERPRISE' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-300'}`}>
                    {t.plan}
                  </span>
                </td>
                <td className="p-4">{t.vehiclesCount} Vans</td>
                <td className="p-4 text-emerald-400">R$ {t.revenue.toFixed(2)}/mês</td>
                <td className="p-4">
                  {t.whatsappConnected ? (
                    <span className="text-emerald-400 text-xs font-bold bg-emerald-400/10 px-2 py-1 rounded">Conectado</span>
                  ) : (
                    <span className="text-slate-500 text-xs font-bold bg-slate-800 px-2 py-1 rounded">Desconectado</span>
                  )}
                </td>
                <td className="p-4 text-right">
                  <button className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded text-white transition-colors">
                    Gerenciar Limites
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MasterDashboard;
