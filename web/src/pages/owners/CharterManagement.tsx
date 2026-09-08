import React, { useState, useEffect } from 'react';
import { Map, Calendar, DollarSign, Clock, Users, Plus, Car, User, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Tooltip } from '../../components/Tooltip';

type Charter = {
  id: string;
  title: string;
  contractor: string;
  price: number;
  startDate: string;
  endDate: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
  vehicleId?: string;
  driverId?: string;
};

export const CharterManagement: React.FC = () => {
  const { user } = useAuth();
  const [charters, setCharters] = useState<Charter[]>([]);
  const [loading, setLoading] = useState(true);

  // Mock Data
  useEffect(() => {
    setTimeout(() => {
      setCharters([
        {
          id: '1',
          title: 'Excursão Beto Carrero',
          contractor: 'Igreja Vida Nova',
          price: 2500,
          startDate: '2026-10-15T06:00:00Z',
          endDate: '2026-10-17T22:00:00Z',
          status: 'PENDING',
        },
        {
          id: '2',
          title: 'Transfer Aeroporto (Bate-volta)',
          contractor: 'Empresa XYZ',
          price: 350,
          startDate: '2026-09-10T14:00:00Z',
          endDate: '2026-09-10T18:00:00Z',
          status: 'COMPLETED',
        }
      ]);
      setLoading(false);
    }, 1000);
  }, []);

  if (user?.role !== 'OWNER' && user?.role !== 'MANAGER') {
    return <div className="p-8 text-red-500 font-bold">Acesso restrito à gestão de frota.</div>;
  }

  const formatDateTime = (isoString: string) => {
    return new Date(isoString).toLocaleString('pt-BR', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Map className="w-8 h-8 text-amber-500" />
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            Fretamentos e Eventos
            <Tooltip content="Viagens esporádicas, turismo e fretamento contínuo (com data de início e fim)." />
          </h1>
        </div>
        <button className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-6 py-3 rounded-xl flex items-center gap-2 transition-colors">
          <Plus className="w-5 h-5" /> Novo Fretamento
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-amber-500 to-amber-600 p-6 rounded-3xl text-slate-950 shadow-[0_0_40px_rgba(245,158,11,0.15)]">
          <div className="flex items-center gap-2 font-bold opacity-80 mb-2">
            <DollarSign className="w-5 h-5" /> Faturamento Estimado
            <Tooltip content="Total de todas as viagens agendadas que ainda não foram concluídas." />
          </div>
          <div className="text-3xl font-black">R$ 2.500,00</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
          <div className="flex items-center gap-2 text-slate-400 font-medium mb-2">
            <Calendar className="w-5 h-5" /> Próxima Viagem
          </div>
          <div className="text-xl font-bold text-white">15 de Outubro</div>
          <div className="text-sm text-amber-400 mt-1">Excursão Beto Carrero</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
          <div className="flex items-center gap-2 text-slate-400 font-medium mb-2">
            <CheckCircle2 className="w-5 h-5" /> Viagens Realizadas (Mês)
          </div>
          <div className="text-3xl font-bold text-white">1</div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">Agenda de Fretamentos</h2>
        </div>
        
        {loading ? (
          <div className="p-12 text-center text-slate-400">Carregando viagens...</div>
        ) : charters.length === 0 ? (
          <div className="p-12 text-center text-slate-400">Nenhum fretamento agendado.</div>
        ) : (
          <div className="divide-y divide-slate-800/50">
            {charters.map(charter => (
              <div key={charter.id} className="p-6 hover:bg-slate-800/30 transition-colors">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                  
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`px-3 py-1 text-xs font-bold rounded-full ${
                        charter.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400' : 
                        charter.status === 'IN_PROGRESS' ? 'bg-blue-500/10 text-blue-400' :
                        charter.status === 'CANCELED' ? 'bg-red-500/10 text-red-400' :
                        'bg-amber-500/10 text-amber-500'
                      }`}>
                        {charter.status}
                      </span>
                      <h3 className="font-bold text-white text-lg">{charter.title}</h3>
                    </div>
                    <div className="text-slate-400 text-sm flex items-center gap-2">
                      <Users className="w-4 h-4" /> Contratante: <strong className="text-slate-300">{charter.contractor}</strong>
                    </div>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex-1 w-full md:w-auto">
                    <div className="flex items-center gap-4 text-sm text-slate-300 mb-2">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-emerald-400" />
                        <span>Início: <strong>{formatDateTime(charter.startDate)}</strong></span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-slate-300">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-red-400" />
                        <span>Fim: <strong>{formatDateTime(charter.endDate)}</strong></span>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col md:items-end justify-center w-full md:w-auto gap-3">
                    <div className="text-2xl font-black text-emerald-400 font-mono">
                      R$ {charter.price.toFixed(2)}
                    </div>
                    <div className="flex gap-2">
                      <button className="flex items-center gap-1 text-xs bg-slate-800 text-slate-300 hover:text-white px-3 py-2 rounded-lg transition-colors border border-dashed border-slate-700">
                        <Car className="w-3 h-3" /> Van: Pendente
                      </button>
                      <button className="flex items-center gap-1 text-xs bg-slate-800 text-slate-300 hover:text-white px-3 py-2 rounded-lg transition-colors border border-dashed border-slate-700">
                        <User className="w-3 h-3" /> Motorista: Pendente
                      </button>
                    </div>
                  </div>

                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CharterManagement;
