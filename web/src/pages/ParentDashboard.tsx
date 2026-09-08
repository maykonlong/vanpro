import React from 'react';
import { ShieldCheck, MapPin, Bus } from 'lucide-react';

const ParentDashboard: React.FC = () => {
  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-6">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center mb-4">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-extrabold text-white">App dos Pais</h1>
          <p className="text-slate-400 text-sm">Acompanhe seu filho com segurança.</p>
        </div>

        <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center space-y-2">
          <Bus className="w-8 h-8 text-emerald-400 mx-auto" />
          <h3 className="font-bold text-white">Van a Caminho</h3>
          <p className="text-xs text-slate-400">Previsão de chegada: 10 minutos</p>
        </div>

        <button className="w-full bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-2xl flex items-center justify-center gap-2 font-bold shadow-lg shadow-blue-900/20">
          <MapPin className="w-5 h-5" /> Abrir Mapa de Rastreio
        </button>
      </div>
    </div>
  );
};

export default ParentDashboard;
