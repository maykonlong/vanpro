import React, { useState } from 'react';
import { Bus, ShieldCheck, Users, Package, Sparkles, Navigation, Layers } from 'lucide-react';
import OwnerDashboard from './components/OwnerDashboard';
import DriverAppView from './components/DriverAppView';
import ParentAppView from './components/ParentAppView';
import FreightCalculator from './components/FreightCalculator';
import AiSimulatorModal from './components/AiSimulatorModal';

export default function App() {
  const [activeTab, setActiveTab] = useState('OWNER'); // OWNER, DRIVER, PARENT
  const [showAiModal, setShowAiModal] = useState(false);
  const [showFreightModal, setShowFreightModal] = useState(false);

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-lg glow-emerald">
              <Bus className="w-6 h-6 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xl tracking-tight text-white">Van<span className="text-emerald-400">Pro</span></span>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                  PostgreSQL SaaS
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">Sistema Operacional para Vans, Escolar & Fretes</p>
            </div>
          </div>

          {/* Seletor de Perfil / Visão */}
          <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('OWNER')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'OWNER'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Bus className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Frotista</span>
            </button>

            <button
              onClick={() => setActiveTab('DRIVER')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'DRIVER'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Navigation className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Motorista</span>
            </button>

            <button
              onClick={() => setActiveTab('PARENT')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'PARENT'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Pais</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content View */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        {activeTab === 'OWNER' && (
          <OwnerDashboard 
            onOpenAiSimulator={() => setShowAiModal(true)} 
            onOpenFreightCalc={() => setShowFreightModal(true)} 
          />
        )}
        {activeTab === 'DRIVER' && <DriverAppView />}
        {activeTab === 'PARENT' && <ParentAppView />}
      </main>

      {/* Modal / Overlay: Simulador de IA */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <AiSimulatorModal onClose={() => setShowAiModal(false)} />
        </div>
      )}

      {/* Modal / Overlay: Calculadora de Fretes */}
      {showFreightModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <FreightCalculator onClose={() => setShowFreightModal(false)} />
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 text-center text-xs text-slate-500">
        Plataforma VanPro © 2026 — Clean Architecture com PostgreSQL & Multitenant.
      </footer>
    </div>
  );
}
