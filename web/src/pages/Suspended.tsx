import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldOff, CreditCard } from 'lucide-react';

const Suspended: React.FC = () => (
  <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
    <div className="w-full max-w-md text-center">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-rose-500/10 text-rose-400 mb-6 border border-rose-500/20">
        <ShieldOff className="w-10 h-10" />
      </div>
      <h1 className="text-3xl font-extrabold text-white mb-3">Conta Suspensa</h1>
      <p className="text-slate-400 mb-8">
        O período de trial desta empresa expirou ou há uma fatura em aberto. 
        Para continuar usando o VanPro, reactive seu plano.
      </p>
      <div className="space-y-3">
        <a
          href="https://wa.me/5511999999999?text=Quero+reativar+minha+conta+VanPro"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
        >
          <CreditCard className="w-5 h-5" /> Reativar Meu Plano
        </a>
        <Link
          to="/login"
          className="block w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-4 rounded-xl transition-colors"
        >
          Voltar ao Login
        </Link>
      </div>
    </div>
  </div>
);

export default Suspended;
