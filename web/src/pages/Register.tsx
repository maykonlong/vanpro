import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Bus, Building2, UserCircle, Mail, Lock, ArrowRight, CheckCircle } from 'lucide-react';

const Register: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    companyName: '',
    document: '',
    ownerName: '',
    ownerEmail: '',
    ownerPassword: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('http://localhost:3000/api/v1/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form)
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Erro ao criar conta.');
        return;
      }

      login({
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        role: data.user.role,
        token: data.user.token
      });

      navigate('/owner');

    } catch (err) {
      setError('Falha na conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 mb-4 border border-emerald-500/20">
            <Bus className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-extrabold text-white">Comece Grátis Agora</h1>
          <p className="text-slate-400 mt-2">7 dias de trial completo, sem cartão de crédito.</p>
        </div>

        {/* Benefícios */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {['Sem cartão', '7 dias grátis', 'Cancele quando quiser'].map((b) => (
            <div key={b} className="bg-slate-900 border border-emerald-500/20 rounded-xl p-3 text-center">
              <CheckCircle className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
              <p className="text-xs text-slate-300 font-bold">{b}</p>
            </div>
          ))}
        </div>

        {/* Formulário */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> Nome da Empresa / Frota
              </label>
              <input
                name="companyName"
                type="text"
                required
                placeholder="Ex: TransVan do João"
                value={form.companyName}
                onChange={handleChange}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> CNPJ ou CPF
              </label>
              <input
                name="document"
                type="text"
                required
                placeholder="00.000.000/0001-00"
                value={form.document}
                onChange={handleChange}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="border-t border-slate-800 pt-4">
              <p className="text-xs text-slate-500 mb-3 font-bold uppercase tracking-wider">Dados do Responsável</p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1 flex items-center gap-1.5">
                    <UserCircle className="w-3.5 h-3.5" /> Nome Completo
                  </label>
                  <input
                    name="ownerName"
                    type="text"
                    required
                    placeholder="Seu nome"
                    value={form.ownerName}
                    onChange={handleChange}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" /> E-mail de Acesso
                  </label>
                  <input
                    name="ownerEmail"
                    type="email"
                    required
                    placeholder="seu@email.com"
                    value={form.ownerEmail}
                    onChange={handleChange}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" /> Crie uma Senha
                  </label>
                  <input
                    name="ownerPassword"
                    type="password"
                    required
                    minLength={8}
                    placeholder="Mínimo 8 caracteres"
                    value={form.ownerPassword}
                    onChange={handleChange}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-emerald-900/30 flex items-center justify-center gap-2 mt-2 transition-colors"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Criar Conta e Começar Trial <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          <p className="text-center text-slate-500 text-sm mt-6">
            Já tem conta?{' '}
            <Link to="/login" className="text-emerald-500 hover:text-emerald-400 font-bold">
              Fazer login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;
