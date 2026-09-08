import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Bus, KeyRound, SteeringWheel, Users } from 'lucide-react';

const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<'OWNER' | 'DRIVER' | 'PARENT'>('OWNER');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Mock Login - Bypass API just for UI test in Phase 4
    setTimeout(() => {
      login({
        id: '123',
        name: role === 'OWNER' ? 'Gestor Frotista' : role === 'DRIVER' ? 'Motorista Silva' : 'Pai do João',
        email: 'teste@vanpro.com',
        role: role,
        token: 'fake-jwt-token'
      });

      if (role === 'OWNER') navigate('/owner');
      if (role === 'DRIVER') navigate('/driver');
      if (role === 'PARENT') navigate('/parent');

      setLoading(false);
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 mb-4">
            <Bus className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-extrabold text-white">VANOS</h1>
          <p className="text-slate-400 mt-2">Sistema Operacional de Vans</p>
        </div>

        <div className="flex gap-2 mb-6 bg-slate-950 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setRole('OWNER')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${role === 'OWNER' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Gestor
          </button>
          <button
            type="button"
            onClick={() => setRole('DRIVER')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${role === 'DRIVER' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Motorista
          </button>
          <button
            type="button"
            onClick={() => setRole('PARENT')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${role === 'PARENT' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Pais
          </button>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1">E-mail de acesso</label>
            <input
              type="email"
              required
              defaultValue="admin@vanos.com"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1">Senha</label>
            <input
              type="password"
              required
              defaultValue="123456"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2 mt-6 disabled:opacity-50"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <KeyRound className="w-5 h-5" /> Entrar no VANOS
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
