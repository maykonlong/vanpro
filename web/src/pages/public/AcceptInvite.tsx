import React, { useState } from 'react';
import { UserPlus, ShieldAlert, CheckCircle2, Building2 } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';

export const AcceptInvite: React.FC = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [status, setStatus] = useState<'IDLE' | 'LOADING' | 'SUCCESS'>('IDLE');

  // Na vida real, a API retornaria o nome da nova empresa pelo token
  const companyName = "Vans Express"; 

  const handleAccept = (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptedTerms) return;

    setStatus('LOADING');
    setTimeout(() => {
      setStatus('SUCCESS');
      setTimeout(() => navigate('/dashboard'), 2000);
    }, 1500);
  };

  if (status === 'SUCCESS') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 max-w-md w-full text-center">
          <CheckCircle2 className="w-20 h-20 text-emerald-500 mx-auto mb-6" />
          <h2 className="text-2xl font-bold text-white mb-2">Convite Aceito!</h2>
          <p className="text-slate-400">Você agora faz parte da frota {companyName}. Redirecionando para o painel...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-lg w-full">
        <div className="flex justify-center mb-6">
          <div className="bg-amber-500/20 p-4 rounded-full border border-amber-500/30">
            <UserPlus className="w-10 h-10 text-amber-500" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-center text-white mb-2">Convite para Equipe</h1>
        <p className="text-slate-400 text-center mb-8">
          Você foi convidado para trabalhar como Motorista na frota <strong className="text-white">{companyName}</strong>.
        </p>

        <form onSubmit={handleAccept} className="space-y-6">
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-white font-bold flex items-center gap-2">
              <Building2 className="w-5 h-5 text-amber-500" /> O que muda?
            </h3>
            <ul className="space-y-3 text-sm text-slate-400">
              <li className="flex gap-2">
                <span className="text-amber-500">•</span>
                Você fará parte da nova empresa ({companyName}) e receberá as rotas deles.
              </li>
              <li className="flex gap-2">
                <span className="text-red-400">•</span>
                Caso você pertença a outra empresa atualmente, seu contrato antigo será <strong>Arquivado</strong>.
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-400">•</span>
                Você não perderá dados antigos. Poderá visualizar planilhas passadas através do seletor "Histórico".
              </li>
            </ul>
          </div>

          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="relative flex items-center mt-1">
              <input 
                type="checkbox" 
                className="peer sr-only"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
              />
              <div className="w-5 h-5 border-2 border-slate-700 rounded bg-slate-950 peer-checked:bg-amber-500 peer-checked:border-amber-500 transition-all flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-slate-950 opacity-0 peer-checked:opacity-100 transition-opacity" />
              </div>
            </div>
            <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
              Eu entendo as condições e aceito mudar meu perfil para a nova frota.
            </span>
          </label>

          <button 
            type="submit"
            disabled={!acceptedTerms || status === 'LOADING'}
            className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed hover:scale-[1.02]"
          >
            {status === 'LOADING' ? 'Processando Contrato...' : 'Aceitar Convite'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AcceptInvite;
