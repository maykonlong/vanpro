import React, { useState } from 'react';
import { MapPin, Navigation, Bell, ShieldCheck, CheckCircle2, AlertCircle, Phone, Calendar } from 'lucide-react';

export default function ParentAppView() {
  const [absenceNotified, setAbsenceNotified] = useState(false);

  return (
    <div className="max-w-md mx-auto space-y-4">
      {/* Top Header */}
      <div className="glass-panel p-4 rounded-2xl flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Portal da Família</span>
          <h2 className="font-bold text-white text-base">João Rodrigues</h2>
          <p className="text-xs text-slate-400">Colégio Dom Pedro II • 6º Ano A</p>
        </div>
        <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-bold">
          JR
        </div>
      </div>

      {/* Rastreamento da Van no Mapa */}
      <div className="glass-card p-5 rounded-2xl space-y-3 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-xs font-bold text-white uppercase tracking-wider">Van a caminho</span>
          </div>
          <span className="text-xs font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2.5 py-1 rounded-full">
            Chegada em 07:18 AM
          </span>
        </div>

        {/* Card do Mapa Simulado */}
        <div className="h-40 bg-slate-900 rounded-xl border border-slate-800 relative flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 opacity-30 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px]"></div>
          
          {/* Rota Simulada */}
          <div className="relative z-10 text-center space-y-2">
            <div className="inline-flex items-center gap-2 bg-emerald-500 text-slate-950 px-3 py-1.5 rounded-full text-xs font-extrabold shadow-lg">
              <Navigation className="w-3.5 h-3.5 animate-bounce" />
              Van 01 (Ford Transit) • 3.2 km da sua casa
            </div>
            <p className="text-[11px] text-slate-400">Motorista: Carlos Oliveira • Placa ABC-1D23</p>
          </div>
        </div>

        {/* Notificação em Destaque */}
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <div className="text-xs text-slate-200">
            <span className="font-bold text-emerald-300">Embarque confirmado:</span> João embarcou na van às 06:32 com segurança.
          </div>
        </div>
      </div>

      {/* Botão de Ação Rápida: Avisar Ausência */}
      <div className="glass-card p-4 rounded-2xl space-y-3">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ações do Responsável</h3>

        {absenceNotified ? (
          <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl text-xs text-blue-300 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />
            Ausência notificada com sucesso ao motorista Carlos.
          </div>
        ) : (
          <button
            onClick={() => setAbsenceNotified(true)}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
          >
            <AlertCircle className="w-4 h-4 text-amber-400" />
            Avisar que o João NÃO irá à escola hoje
          </button>
        )}
      </div>

      {/* Histórico de Notificações */}
      <div className="glass-panel p-4 rounded-2xl space-y-3">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Bell className="w-3.5 h-3.5 text-emerald-400" />
          Histórico Recente
        </h3>

        <div className="space-y-2 text-xs">
          <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 flex justify-between items-center">
            <span className="text-slate-300">Van iniciou a rota da manhã</span>
            <span className="text-slate-500 text-[10px]">06:15</span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 flex justify-between items-center">
            <span className="text-slate-300">Mensalidade de Setembro Paga</span>
            <span className="text-emerald-400 text-[10px] font-bold">R$ 580,00</span>
          </div>
        </div>
      </div>
    </div>
  );
}
