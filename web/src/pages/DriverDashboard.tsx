import React, { useState, useEffect } from 'react';
import { Navigation, Clock, Camera, AlertTriangle, KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// Enum simulado das batidas
type PunchState = 'NOT_STARTED' | 'CLOCKED_IN' | 'LUNCH_STARTED' | 'LUNCH_ENDED' | 'CLOCKED_OUT';

const DriverDashboard: React.FC = () => {
  const { user } = useAuth();
  const [punchState, setPunchState] = useState<PunchState>('NOT_STARTED');
  const [loading, setLoading] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);

  // Busca do estado atual do ponto no backend
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/v1/timecard/status', {
          headers: { 'Authorization': `Bearer ${user?.token}` }
        });
        if (res.ok) {
          const data = await res.json();
          // Mapear status do banco (PENDING, ON_ROUTE, PAUSED, COMPLETED) para UI
          if (data.status === 'COMPLETED') setPunchState('CLOCKED_OUT');
          else if (data.status === 'PAUSED') setPunchState('LUNCH_STARTED');
          else if (data.status === 'ON_ROUTE') setPunchState('CLOCKED_IN');
          else setPunchState('NOT_STARTED');
        }
      } catch (err) {
        console.error('Falha ao buscar status do ponto', err);
      }
    };
    if (user?.token) fetchStatus();
  }, [user]);

  const handlePunch = async (type: string) => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/v1/timecard/punch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user?.token}`
        },
        body: JSON.stringify({
          action: type,
          vehicleId: 'v1', // Idealmente viria do contexto do motorista
          lat: -23.5505, // mock gps
          lng: -46.6333
        })
      });

      if (!res.ok) throw new Error('Falha ao registrar ponto');
      
      if (type === 'CLOCK_IN') setPunchState('CLOCKED_IN');
      if (type === 'LUNCH_START') setPunchState('LUNCH_STARTED');
      if (type === 'LUNCH_END') setPunchState('LUNCH_ENDED');
      if (type === 'CLOCK_OUT') setPunchState('CLOCKED_OUT');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestToken = () => {
    // Simula geração de token para correção manual
    const token = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedToken(token);
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-extrabold text-white">App Motorista</h1>
          <p className="text-emerald-400 font-medium text-sm">Bem-vindo, {user?.name}</p>
        </div>

        {/* Módulo de Ponto Eletrônico - 4 Batidas */}
        <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-emerald-400" /> Controle de Jornada
            </h2>
            <span className="text-[10px] px-2 py-1 bg-slate-800 text-slate-300 rounded-full font-mono">
              Hoje
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={() => handlePunch('CLOCK_IN')}
              disabled={punchState !== 'NOT_STARTED' || loading}
              className={`p-3 rounded-xl font-bold text-xs shadow-md transition-all ${
                punchState === 'NOT_STARTED' 
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white' 
                  : punchState === 'CLOCKED_IN' || punchState === 'LUNCH_STARTED' || punchState === 'LUNCH_ENDED' || punchState === 'CLOCKED_OUT'
                  ? 'bg-emerald-900/50 text-emerald-500 border border-emerald-800/50 cursor-not-allowed'
                  : 'bg-slate-800 text-slate-500'
              }`}
            >
              1. Início Rota
            </button>

            <button 
              onClick={() => handlePunch('LUNCH_START')}
              disabled={punchState !== 'CLOCKED_IN' || loading}
              className={`p-3 rounded-xl font-bold text-xs shadow-md transition-all ${
                punchState === 'CLOCKED_IN' 
                  ? 'bg-amber-600 hover:bg-amber-500 text-white' 
                  : punchState === 'LUNCH_STARTED' || punchState === 'LUNCH_ENDED' || punchState === 'CLOCKED_OUT'
                  ? 'bg-amber-900/50 text-amber-500 border border-amber-800/50 cursor-not-allowed'
                  : 'bg-slate-800 text-slate-500'
              }`}
            >
              2. Pausa Almoço
            </button>

            <button 
              onClick={() => handlePunch('LUNCH_END')}
              disabled={punchState !== 'LUNCH_STARTED' || loading}
              className={`p-3 rounded-xl font-bold text-xs shadow-md transition-all ${
                punchState === 'LUNCH_STARTED' 
                  ? 'bg-amber-600 hover:bg-amber-500 text-white' 
                  : punchState === 'LUNCH_ENDED' || punchState === 'CLOCKED_OUT'
                  ? 'bg-amber-900/50 text-amber-500 border border-amber-800/50 cursor-not-allowed'
                  : 'bg-slate-800 text-slate-500'
              }`}
            >
              3. Retorno Almoço
            </button>

            <button 
              onClick={() => handlePunch('CLOCK_OUT')}
              disabled={punchState !== 'LUNCH_ENDED' || loading}
              className={`p-3 rounded-xl font-bold text-xs shadow-md transition-all ${
                punchState === 'LUNCH_ENDED' 
                  ? 'bg-red-600 hover:bg-red-500 text-white' 
                  : punchState === 'CLOCKED_OUT'
                  ? 'bg-red-900/50 text-red-500 border border-red-800/50 cursor-not-allowed'
                  : 'bg-slate-800 text-slate-500'
              }`}
            >
              4. Fim de Rota
            </button>
          </div>

          {punchState === 'CLOCKED_OUT' && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl text-xs font-bold text-center">
              Jornada Finalizada com Sucesso!
            </div>
          )}
        </div>

        {/* Botões de Ação */}
        <div className="grid grid-cols-2 gap-4">
          <button className="bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-2xl flex flex-col items-center justify-center gap-2 font-bold border border-slate-700">
            <Navigation className="w-6 h-6 text-blue-400" /> 
            <span className="text-xs">Navegação</span>
          </button>
          <button className="bg-slate-800 hover:bg-slate-700 text-white p-4 rounded-2xl flex flex-col items-center justify-center gap-2 font-bold border border-slate-700">
            <AlertTriangle className="w-6 h-6 text-amber-400" /> 
            <span className="text-xs">Ocorrência</span>
          </button>
        </div>

        {/* Módulo de Retificação de Ponto (Token) */}
        <div className="border-t border-slate-800 pt-6 mt-6">
          <button 
            onClick={handleRequestToken}
            className="w-full bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-300 p-3 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-colors"
          >
            <KeyRound className="w-4 h-4 text-purple-400" /> Solicitar Ajuste de Ponto (Token)
          </button>
          
          {generatedToken && (
            <div className="mt-4 bg-purple-900/20 border border-purple-500/30 p-4 rounded-xl text-center space-y-2">
              <p className="text-xs text-purple-300 font-medium">Envie este Token para o Gestor aprovar a alteração:</p>
              <div className="text-3xl font-extrabold text-white tracking-widest">{generatedToken}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DriverDashboard;
