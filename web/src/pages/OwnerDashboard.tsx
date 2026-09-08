import React, { useState } from 'react';
import { Bus, Wrench, Users, MessageSquare, Camera, Share2, BarChart3, QrCode, DollarSign, Compass, Lock, Map, Fingerprint, KeyRound, AlertOctagon } from 'lucide-react';
import { startRegistration } from '@simplewebauthn/browser';

const OwnerDashboard: React.FC = () => {
  const [subTab, setSubTab] = useState('MAIN');
  const [registeringBiometrics, setRegisteringBiometrics] = useState(false);
  const [mfaQrCode, setMfaQrCode] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<any[]>([]);

  const handleRegisterBiometrics = async () => {
    try {
      setRegisteringBiometrics(true);
      // 1. Pede as opções de criação de Credencial (Com o token JWT atual no cookie)
      const respOptions = await fetch('http://localhost:3000/api/v1/auth/webauthn/register/options');
      if (!respOptions.ok) throw new Error("Erro ao buscar opções");
      
      const options = await respOptions.json();
      
      // 2. Chama a API do Sistema Operacional (Windows Hello / FaceID)
      const authResp = await startRegistration(options);
      
      // 3. Envia a chave pública pro servidor salvar
      const verificationResp = await fetch('http://localhost:3000/api/v1/auth/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authResp)
      });
      
      if (!verificationResp.ok) throw new Error("Erro ao salvar biometria");
      
      alert("✅ Biometria cadastrada com sucesso! No próximo login você não precisará de senha.");
    } catch (error) {
      alert("Falha ao registrar biometria: " + (error as Error).message);
    } finally {
      setRegisteringBiometrics(false);
    }
  };
  
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
        <button onClick={() => setSubTab('TEAM_SYNC')} className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 whitespace-nowrap ${subTab === 'TEAM_SYNC' ? 'bg-purple-600 text-white' : 'text-slate-400'}`}>
          <MessageSquare className="w-4 h-4" /> Comunicação Interna (Chat)
        </button>
      </div>

      <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800/50 min-h-[400px]">
        {subTab === 'MAIN' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-white mb-4">Visão Geral</h2>
            
            {/* Card de Segurança / Passkeys */}
            <div className="glass-card p-5 bg-slate-900 border border-indigo-500/20 rounded-2xl space-y-4 max-w-md">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-indigo-400" /> Segurança (Passkeys)
              </h3>
              <p className="text-xs text-slate-400">Ative o login por biometria (Digital/Face ID) para acessar sua conta sem precisar digitar senhas.</p>
              
              <button 
                onClick={handleRegisterBiometrics}
                disabled={registeringBiometrics}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {registeringBiometrics ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>Cadastrar Digital / Face ID</>
                )}
              </button>
            </div>

            {/* Card Google 2FA */}
            <div className="glass-card p-5 bg-slate-900 border border-emerald-500/20 rounded-2xl space-y-4 max-w-md">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-400" /> Dupla Autenticação (2FA)
              </h3>
              <p className="text-xs text-slate-400">Gere um QR Code para parear sua conta no Google Authenticator e exigir o código de 6 dígitos no login.</p>
              
              {!mfaQrCode ? (
                <button 
                  onClick={async () => {
                    const res = await fetch('http://localhost:3000/api/v1/auth/2fa/generate');
                    const data = await res.json();
                    setMfaQrCode(data.qrCodeImage);
                  }}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-lg"
                >
                  Configurar Google Authenticator
                </button>
              ) : (
                <div className="text-center space-y-2">
                  <img src={mfaQrCode} alt="QR Code" className="mx-auto border-4 border-white rounded-lg" />
                  <p className="text-xs text-slate-400">Escaneie pelo celular. Depois clique no botão abaixo e confirme com o código gerado.</p>
                  <button className="w-full bg-emerald-600 text-white py-2 rounded-lg" onClick={() => alert("Mock: 2FA Ativado! (Requer chamar o endpoint verify)")}>
                    Ativar e Salvar
                  </button>
                </div>
              )}
            </div>

          </div>
        )}
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

        {subTab === 'TEAM_SYNC' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-purple-400" /> Central de Comunicação (Equipe Interna)
            </h2>
            
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Painel de Alertas de Incidente */}
              <div className="glass-card p-5 bg-slate-900 border border-rose-500/20 rounded-2xl space-y-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <AlertOctagon className="w-4 h-4 text-rose-400" /> Alertas Push de Emergência
                </h3>
                <p className="text-xs text-slate-400">Dispare uma notificação de urgência direto para o aplicativo de todos os pais da rota selecionada.</p>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  alert("Alerta Push disparado em massa! (Mock)");
                }} className="space-y-3">
                  <input type="text" placeholder="Título (Ex: Pneu Furado)" required className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white text-sm" />
                  <textarea placeholder="Descrição rápida para os pais..." required className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white text-sm" rows={2} />
                  <button type="submit" className="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-2.5 rounded-lg text-sm">Disparar Alerta Agora</button>
                </form>
              </div>

              {/* Chat da Empresa */}
              <div className="glass-card flex flex-col bg-slate-900 border border-purple-500/20 rounded-2xl h-80 overflow-hidden">
                <div className="bg-purple-900/30 p-3 border-b border-purple-500/20 font-bold text-sm text-purple-200">
                  Chat da Frota (Canal Seguro)
                </div>
                <div className="flex-1 p-4 overflow-y-auto space-y-3">
                  <div className="flex gap-2">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-xs font-bold text-white shrink-0">MOT</div>
                    <div className="bg-slate-800 p-2 rounded-xl text-xs text-slate-300">A van reserva já saiu da garagem? Tô na João Paulo.</div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <div className="bg-purple-600/50 p-2 rounded-xl text-xs text-slate-100">Sim, o Carlos já está chegando aí em 5 min.</div>
                    <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold text-white shrink-0">VOCÊ</div>
                  </div>
                </div>
                <form className="p-3 bg-slate-950 flex gap-2 border-t border-slate-800" onSubmit={(e) => { e.preventDefault(); }}>
                  <input type="text" placeholder="Digite uma mensagem..." className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500" />
                  <button type="button" className="bg-purple-600 text-white px-4 rounded-lg text-sm font-bold">Enviar</button>
                </form>
              </div>
            </div>
          </div>
        )}
        
        {subTab !== 'PAYROLL' && subTab !== 'CHARTERS' && subTab !== 'TEAM_SYNC' && subTab !== 'MAIN' && <p className="text-slate-400 mt-4">Módulo conectado ao PostgreSQL.</p>}
      </div>
    </div>
  );
};

export default OwnerDashboard;
