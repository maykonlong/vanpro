import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Bus, TrendingUp, Sparkles, MapPin, Zap } from 'lucide-react';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans selection:bg-indigo-500/30">
      
      {/* Navbar Mínima */}
      <nav className="flex justify-between items-center p-6 md:px-12 max-w-7xl mx-auto border-b border-slate-800/50">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <Bus className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-black tracking-tight text-white">VanPro<span className="text-indigo-500">.</span></span>
        </div>
        <div className="flex gap-4">
          <button onClick={() => navigate('/login')} className="px-5 py-2 text-sm font-bold text-slate-300 hover:text-white transition-colors">Entrar</button>
          <button onClick={() => navigate('/login')} className="bg-white text-slate-900 px-5 py-2 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors shadow-lg shadow-white/10">Teste Grátis</button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-20 pb-32 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none"></div>
        
        <div className="max-w-5xl mx-auto px-6 text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-sm font-bold mb-8">
            <Sparkles className="w-4 h-4" /> A revolução na gestão de frotas escolares
          </div>
          <h1 className="text-5xl md:text-7xl font-black text-white mb-8 tracking-tight leading-tight">
            Pilote sua frota escolar com <br/> a precisão de um <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">Unicórnio B2B.</span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-400 mb-12 max-w-3xl mx-auto leading-relaxed">
            Esqueça as planilhas e o WhatsApp caótico. O VanPro automatiza cobranças, traça a rota perfeita com IA e avisa os pais em tempo real.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <button onClick={() => navigate('/login')} className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-2xl text-lg font-bold flex items-center justify-center gap-2 transition-transform hover:scale-105 shadow-xl shadow-indigo-600/30">
              Assinar Agora
            </button>
            <button className="bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 px-8 py-4 rounded-2xl text-lg font-bold transition-colors">
              Falar com Especialista
            </button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 bg-slate-900 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            
            <div className="bg-slate-950 p-8 rounded-3xl border border-slate-800 hover:border-indigo-500/50 transition-colors">
              <div className="w-14 h-14 bg-indigo-500/10 rounded-2xl flex items-center justify-center mb-6">
                <TrendingUp className="w-7 h-7 text-indigo-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">Motor Financeiro Asaas</h3>
              <p className="text-slate-400 leading-relaxed">
                Boletos e PIX gerados automaticamente. A baixa é instantânea e o DRE da sua empresa fica sempre no verde sem você mover um dedo.
              </p>
            </div>

            <div className="bg-slate-950 p-8 rounded-3xl border border-slate-800 hover:border-emerald-500/50 transition-colors">
              <div className="w-14 h-14 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-6">
                <MapPin className="w-7 h-7 text-emerald-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">Roteamento Caixeiro Viajante</h3>
              <p className="text-slate-400 leading-relaxed">
                Integração com Google Maps que calcula a ordem matemática mais rápida de pegar os alunos, economizando até 30% de combustível.
              </p>
            </div>

            <div className="bg-slate-950 p-8 rounded-3xl border border-slate-800 hover:border-purple-500/50 transition-colors">
              <div className="w-14 h-14 bg-purple-500/10 rounded-2xl flex items-center justify-center mb-6">
                <Zap className="w-7 h-7 text-purple-400" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-4">Assessora IA & WhatsApp</h3>
              <p className="text-slate-400 leading-relaxed">
                A IA detecta quem faz aniversário e quem está devendo, gerando mensagens incríveis que são disparadas direto no celular dos pais.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* Footer Trust */}
      <footer className="py-12 text-center border-t border-slate-800 bg-slate-950">
        <div className="flex justify-center items-center gap-2 mb-4">
           <ShieldCheck className="w-6 h-6 text-emerald-500" />
           <span className="text-sm font-bold text-slate-300">Auditoria Blindada. 100% de conformidade com LGPD e ECA.</span>
        </div>
        <p className="text-xs text-slate-500">© 2026 VanPro Elite SaaS. Todos os direitos reservados.</p>
      </footer>

    </div>
  );
};

export default LandingPage;
