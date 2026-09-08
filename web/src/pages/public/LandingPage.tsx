import React from 'react';
import { ShieldCheck, Truck, BarChart3, Users, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans selection:bg-amber-500/30 selection:text-amber-200">
      {/* Header */}
      <header className="fixed top-0 w-full bg-slate-950/80 backdrop-blur-md border-b border-slate-800 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500 p-2 rounded-lg">
              <Truck className="text-slate-950 w-6 h-6" />
            </div>
            <span className="text-2xl font-black tracking-tight text-white">VAN<span className="text-amber-500">PRO</span></span>
          </div>
          <div className="flex gap-4">
            <button 
              onClick={() => navigate('/login')}
              className="text-slate-300 font-medium hover:text-white transition-colors px-4 py-2"
            >
              Entrar
            </button>
            <button 
              onClick={() => navigate('/register')}
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-6 py-2 rounded-xl transition-all shadow-[0_0_20px_rgba(245,158,11,0.2)]"
            >
              Cadastre-se
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-40 pb-20 px-6 max-w-7xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 mb-8">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-sm font-semibold tracking-wide uppercase">O SaaS Definitivo para Frotas Escolares</span>
        </div>
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-8 leading-tight">
          Gestão <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-600">Militar</span> para<br/>a sua Frota de Vans.
        </h1>
        <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Esqueça o papel e planilhas confusas. Controle pagamentos, rastreie veículos e conecte-se com os pais usando a plataforma mais segura do mercado.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <button 
            onClick={() => navigate('/register')}
            className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-lg px-8 py-4 rounded-2xl flex items-center justify-center gap-2 transition-all hover:scale-105"
          >
            Criar minha Frota agora <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 border-t border-slate-900 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-3 gap-8">
          <div className="bg-slate-950 p-8 rounded-3xl border border-slate-800 hover:border-amber-500/50 transition-colors">
            <BarChart3 className="w-12 h-12 text-amber-500 mb-6" />
            <h3 className="text-xl font-bold mb-4">Gestão Financeira</h3>
            <p className="text-slate-400">Integração nativa com Asaas. Mensalidades, faturas e controle de inadimplência em tempo real.</p>
          </div>
          <div className="bg-slate-950 p-8 rounded-3xl border border-slate-800 hover:border-amber-500/50 transition-colors">
            <Users className="w-12 h-12 text-amber-500 mb-6" />
            <h3 className="text-xl font-bold mb-4">Gestão de Equipe (RH)</h3>
            <p className="text-slate-400">Convide motoristas e auxiliares por link. Controle absoluto de permissões (RBAC) e histórico blindado.</p>
          </div>
          <div className="bg-slate-950 p-8 rounded-3xl border border-slate-800 hover:border-amber-500/50 transition-colors">
            <ShieldCheck className="w-12 h-12 text-amber-500 mb-6" />
            <h3 className="text-xl font-bold mb-4">Criptografia Militar</h3>
            <p className="text-slate-400">Sistema blindado contra injeções SQL e dados de alunos criptografados no banco (AES-256).</p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default LandingPage;
