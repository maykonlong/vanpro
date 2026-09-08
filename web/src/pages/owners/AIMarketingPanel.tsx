import React, { useState } from 'react';
import { Bot, Sparkles, Megaphone, CheckCircle2, XCircle, Send, AlertTriangle, Calendar, Instagram, MessageCircle } from 'lucide-react';

const AIMarketingPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState('DRAFTS');

  // Mock de Rascunhos gerados pela IA
  const [drafts, setDrafts] = useState([
    {
      id: 1,
      type: 'ANIVERSÁRIO',
      channel: 'INSTAGRAM',
      content: '🎉 Hoje é um dia muito especial! Nosso querido passageiro Joãozinho completa 8 anos de idade! Que o seu dia seja repleto de alegrias e brincadeiras. Parabéns da equipe VanPro! 🚐🎂',
      target: 'Joãozinho Silva',
      imageUrl: 'https://images.unsplash.com/photo-1544281679-6617fb081a4b?w=400&q=80',
      status: 'DRAFT',
      date: 'Hoje, 08:00'
    },
    {
      id: 2,
      type: 'COBRANÇA',
      channel: 'WHATSAPP_PRIVATE',
      content: 'Olá! Passando para lembrar com carinho que a mensalidade da Maria no valor de R$ 350,00 vence amanhã. Agradecemos a confiança no nosso transporte! 🚍',
      target: 'Mãe da Maria (Sra. Ana)',
      status: 'DRAFT',
      date: 'Hoje, 09:30'
    }
  ]);

  const approveDraft = (id: number) => {
    setDrafts(drafts.filter(d => d.id !== id));
    alert('✅ Post APROVADO! O sistema enviará automaticamente para a fila de publicação.');
  };

  const rejectDraft = (id: number) => {
    setDrafts(drafts.filter(d => d.id !== id));
  };

  const fireEmergency = () => {
    alert('🚨 EMERGÊNCIA ACIONADA! A IA está gerando mensagens individuais de desculpas, reagendando as rotas no sistema e disparando pelo WhatsApp Privado de todos os pais da Rota 1.');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-20">
      
      {/* Header Premium AI */}
      <div className="bg-gradient-to-r from-indigo-950 via-purple-900 to-indigo-950 border border-purple-500/30 p-8 rounded-3xl relative overflow-hidden shadow-2xl shadow-purple-900/20">
        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl mix-blend-screen"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl mix-blend-screen"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
          <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/30">
            <Bot className="w-10 h-10 text-white" />
          </div>
          <div className="text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
              <h1 className="text-3xl font-extrabold text-white">IA Assessora (VanPro)</h1>
              <span className="px-3 py-1 bg-purple-500/20 text-purple-300 text-xs font-bold rounded-full border border-purple-500/30 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> FASE 23
              </span>
            </div>
            <p className="text-purple-200/80 max-w-2xl">
              Deixe a Inteligência Artificial gerenciar seus relacionamentos. O sistema escreve parabéns, cobra clientes de forma sutil e acalma os pais em dias de imprevistos.
            </p>
          </div>

          <div className="ml-auto mt-4 md:mt-0">
             <button onClick={fireEmergency} className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all group">
                <AlertTriangle className="w-5 h-5 group-hover:scale-110 transition-transform" />
                Emergência (Van Quebrou)
             </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-900 p-2 rounded-2xl border border-slate-800 w-fit">
        <button 
          onClick={() => setActiveTab('DRAFTS')} 
          className={`px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors ${activeTab === 'DRAFTS' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
        >
          <Megaphone className="w-4 h-4" /> Rascunhos da IA ({drafts.length})
        </button>
        <button 
          onClick={() => setActiveTab('CAMPAIGNS')} 
          className={`px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors ${activeTab === 'CAMPAIGNS' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
        >
          <Calendar className="w-4 h-4" /> Campanhas Ativas
        </button>
      </div>

      {/* Rascunhos */}
      {activeTab === 'DRAFTS' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {drafts.map(draft => (
            <div key={draft.id} className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden flex flex-col hover:border-indigo-500/50 transition-colors">
              <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900">
                <div className="flex items-center gap-2">
                  {draft.channel === 'INSTAGRAM' ? <Instagram className="w-4 h-4 text-pink-500" /> : <MessageCircle className="w-4 h-4 text-emerald-500" />}
                  <span className="text-xs font-bold text-slate-300">{draft.type}</span>
                </div>
                <span className="text-[10px] font-mono text-slate-500">{draft.date}</span>
              </div>
              
              <div className="p-5 flex-1 flex flex-col gap-4">
                <div className="flex gap-4">
                  {draft.imageUrl && (
                    <img src={draft.imageUrl} alt="Anexo" className="w-20 h-20 rounded-xl object-cover border border-slate-700" />
                  )}
                  <div>
                    <p className="text-xs text-indigo-400 font-bold mb-1">Público-Alvo: {draft.target}</p>
                    <p className="text-sm text-slate-300 leading-relaxed italic">"{draft.content}"</p>
                  </div>
                </div>
                
                {draft.type === 'ANIVERSÁRIO' && (
                  <div className="bg-emerald-500/10 text-emerald-400 text-[10px] p-2 rounded border border-emerald-500/20 font-bold uppercase tracking-wider">
                    <CheckCircle2 className="w-3 h-3 inline mr-1" /> Imagem Autorizada pelos Pais (LGPD)
                  </div>
                )}
              </div>

              <div className="p-4 bg-slate-950 flex gap-3">
                <button onClick={() => approveDraft(draft.id)} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-colors">
                  <Send className="w-4 h-4" /> Aprovar e Enviar
                </button>
                <button onClick={() => rejectDraft(draft.id)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 rounded-xl font-bold flex items-center justify-center transition-colors">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
          
          {drafts.length === 0 && (
            <div className="col-span-full py-20 text-center text-slate-500">
              <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-bold">Nenhum rascunho pendente.</p>
              <p className="text-sm">A IA está monitorando o sistema e trará novas postagens em breve.</p>
            </div>
          )}
        </div>
      )}

      {/* Campanhas (Apenas Visão Básica) */}
      {activeTab === 'CAMPAIGNS' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8">
           <h2 className="text-xl font-bold text-white mb-6">Automações Ativas</h2>
           <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-950 rounded-xl border border-slate-800">
                 <div>
                    <h3 className="font-bold text-indigo-400">Parabéns Automático (WhatsApp Status & Instagram)</h3>
                    <p className="text-xs text-slate-400">Verifica data de nascimento todos os dias às 08:00h e gera os cards.</p>
                 </div>
                 <div className="w-12 h-6 bg-indigo-600 rounded-full relative cursor-pointer">
                    <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                 </div>
              </div>
              <div className="flex items-center justify-between p-4 bg-slate-950 rounded-xl border border-slate-800">
                 <div>
                    <h3 className="font-bold text-indigo-400">Cobrança Gentil (WhatsApp Privado)</h3>
                    <p className="text-xs text-slate-400">Detecta boletos que vencem em 1 dia e envia lembrete educado.</p>
                 </div>
                 <div className="w-12 h-6 bg-indigo-600 rounded-full relative cursor-pointer">
                    <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default AIMarketingPanel;
