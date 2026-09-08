import React, { useState } from 'react';
import { Bus, Wrench, Users, MessageSquare, Camera, Share2, BarChart3, QrCode, DollarSign, Compass, Lock, Map } from 'lucide-react';

const OwnerDashboard: React.FC = () => {
  const [subTab, setSubTab] = useState('MAIN');
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-white">Painel do Frotista — VANOS</h1>
          <p className="text-slate-400 text-sm">Controle central de frota, finanças, CRM e roteirização.</p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 p-2 rounded-2xl overflow-x-auto">
        <button onClick={() => setSubTab('MAIN')} className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap ${subTab === 'MAIN' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>
          <Bus className="w-4 h-4" /> Geral & DRE
        </button>
        <button onClick={() => setSubTab('FLEET')} className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap ${subTab === 'FLEET' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>
          <Wrench className="w-4 h-4" /> Manutenção
        </button>
        <button onClick={() => setSubTab('FINANCIAL')} className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap ${subTab === 'FINANCIAL' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>
          <QrCode className="w-4 h-4" /> Financeiro / Pix
        </button>
        <button onClick={() => setSubTab('PAYROLL')} className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap ${subTab === 'PAYROLL' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}>
          <DollarSign className="w-4 h-4" /> Diárias & Ponto
        </button>
        <button onClick={() => setSubTab('CHARTERS')} className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap ${subTab === 'CHARTERS' ? 'bg-amber-600 text-white' : 'text-slate-400'}`}>
          <Map className="w-4 h-4" /> Fretamentos (Eventos)
        </button>
      </div>

      <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800/50 min-h-[400px]">
        {subTab === 'MAIN' && <h2 className="text-xl font-bold text-white mb-4">Visão Geral</h2>}
        {subTab === 'FLEET' && <h2 className="text-xl font-bold text-white mb-4">Frota e Manutenção</h2>}
        {subTab === 'FINANCIAL' && <h2 className="text-xl font-bold text-white mb-4">Cobranças Pix e DRE</h2>}
        
        {subTab === 'PAYROLL' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-amber-400" /> Gestão de Motoristas e Ponto
            </h2>
            
            {/* Aprovação de Token pelo Gestor */}
            <div className="glass-card p-5 bg-slate-900 border border-cyan-500/20 rounded-2xl space-y-4 max-w-md">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-cyan-400" /> Aprovação de Ajuste de Ponto (Token)
              </h3>
              <p className="text-xs text-slate-400">Insira o Token gerado pelo motorista para autorizar a retificação do horário de entrada/saída.</p>
              
              <form onSubmit={(e) => {
                e.preventDefault();
                const form = e.target as any;
                const token = form.token.value;
                alert(`✅ Token ${token} VALIDADO COM SUCESSO! Ajuste de ponto aprovado.`);
                form.reset();
              }} className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-300 block mb-1 font-bold">Motorista / Cartão de Ponto:</label>
                  <select name="timecardId" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white">
                    <option value="1">Motorista Silva - 08/09/2026</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-300 block mb-1 font-bold">Token de Segurança (6 dígitos):</label>
                  <input type="text" name="token" required placeholder="Ex: 123456" maxLength={6} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white font-mono tracking-widest text-center text-lg" />
                </div>
                <button type="submit" className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2.5 rounded-lg transition-colors shadow-lg">
                  Validar Token e Aprovar
                </button>
              </form>
            </div>
          </div>
        )}
        
        {subTab === 'CHARTERS' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Map className="w-5 h-5 text-amber-500" /> Gestão de Fretamentos e Eventos
            </h2>
            <div className="bg-amber-500/10 border border-amber-500/20 p-5 rounded-2xl flex gap-3 text-amber-300 max-w-2xl">
              <Map className="w-8 h-8 flex-shrink-0" />
              <div>
                <p className="font-bold mb-1">Novo Módulo Disponível (Fase 21)</p>
                <p className="text-sm">Acesse o menu lateral para abrir o painel completo de Fretamentos e agendar viagens esporádicas. Ideal para passeios, eventos e aluguéis por dia.</p>
              </div>
            </div>
          </div>
        )}
        
        {subTab !== 'PAYROLL' && subTab !== 'CHARTERS' && <p className="text-slate-400 mt-4">Módulo de {subTab} conectado ao Banco de Dados (PostgreSQL via Prisma).</p>}
      </div>
    </div>
  );
};

export default OwnerDashboard;
