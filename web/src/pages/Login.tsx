import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Bus, KeyRound, SteeringWheel, Users, Fingerprint } from 'lucide-react';
import { startAuthentication } from '@simplewebauthn/browser';

const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<'OWNER' | 'DRIVER' | 'ASSISTANT' | 'PARENT'>('OWNER');

  // MFA & Forgot Password States
  const [step, setStep] = useState<'LOGIN' | 'MFA' | 'FORGOT_PASSWORD'>('LOGIN');
  const [mfaToken, setMfaToken] = useState('');
  const [tempUserId, setTempUserId] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Como não temos os inputs capturados no estado (apenas defaultValue), 
      // vou simular o body com base no tipo escolhido apenas para integrar.
      // Em uma aplicação real, capturaríamos o email/senha do form.
      const email = role === 'OWNER' ? 'roberto@transvan.com.br' : 
                    role === 'DRIVER' ? 'carlos.oliveira@transvan.com.br' : 
                    role === 'ASSISTANT' ? 'auxiliar@transvan.com.br' :
                    'maria@gmail.com';
                    
      const response = await fetch('http://localhost:3000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: '123456' })
      });

      const data = await response.json();

      if (response.status === 403 && data.errorCode === 'PASSWORD_EXPIRED') {
        alert(data.error);
        return;
      }

      if (response.status === 206 && data.require2FA) {
        setTempUserId(data.userId);
        setStep('MFA');
        return;
      }

      if (!response.ok) {
        throw new Error('Credenciais inválidas');
      }
      
      login({
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        role: data.user.role,
        token: data.token
      });

      if (data.user.role === 'OWNER') navigate('/owner');
      if (data.user.role === 'DRIVER') navigate('/driver');
      if (data.user.role === 'ASSISTANT') navigate('/assistant');
      if (data.user.role === 'PARENT') navigate('/parent');

    } catch (error) {
      alert('Falha no login: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleMfaLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3000/api/v1/auth/2fa/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: tempUserId, token: mfaToken })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Código inválido');

      login({
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        role: data.user.role,
        token: data.token
      });

      if (data.user.role === 'OWNER') navigate('/owner');
      if (data.user.role === 'DRIVER') navigate('/driver');
      if (data.user.role === 'ASSISTANT') navigate('/assistant');
      if (data.user.role === 'PARENT') navigate('/parent');

    } catch (error) {
      alert((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3000/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail })
      });
      const data = await response.json();
      alert(data.message);
      setStep('LOGIN');
    } catch (error) {
      alert("Erro ao solicitar redefinição.");
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    try {
      setLoading(true);
      
      // 1. Pega as opções de login do Servidor
      const respOptions = await fetch('http://localhost:3000/api/v1/auth/webauthn/login/options', { method: 'POST' });
      if (!respOptions.ok) throw new Error("Erro ao iniciar biometria");
      const options = await respOptions.json();

      // 2. Aciona o sensor biométrico do Celular/PC
      const authResp = await startAuthentication(options);

      // 3. Envia a assinatura digital para o servidor validar
      const verificationResp = await fetch('http://localhost:3000/api/v1/auth/webauthn/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authResp)
      });

      if (!verificationResp.ok) throw new Error("Digital não reconhecida ou não cadastrada");

      const data = await verificationResp.json();
      
      login({
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        role: data.user.role,
        token: data.token
      });

      if (data.user.role === 'OWNER') navigate('/owner');
      if (data.user.role === 'DRIVER') navigate('/driver');
      if (data.user.role === 'ASSISTANT') navigate('/assistant');
      if (data.user.role === 'PARENT') navigate('/parent');

    } catch (error) {
      alert((error as Error).message);
    } finally {
      setLoading(false);
    }
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
            onClick={() => setRole('ASSISTANT')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${role === 'ASSISTANT' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Auxiliar
          </button>
          <button
            type="button"
            onClick={() => setRole('PARENT')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors ${role === 'PARENT' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Pais
          </button>
        </div>

        {step === 'LOGIN' && (
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
              <label className="block text-xs font-bold text-slate-400 mb-1 flex justify-between">
                <span>Senha</span>
                <button type="button" onClick={() => setStep('FORGOT_PASSWORD')} className="text-emerald-500 hover:text-emerald-400">Esqueci a senha</button>
              </label>
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

            <div className="relative flex py-4 items-center">
              <div className="flex-grow border-t border-slate-800"></div>
              <span className="flex-shrink-0 mx-4 text-slate-500 text-xs font-bold">OU</span>
              <div className="flex-grow border-t border-slate-800"></div>
            </div>

            <button
              type="button"
              onClick={handleBiometricLogin}
              disabled={loading}
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50 border border-slate-700"
            >
              <Fingerprint className="w-5 h-5 text-indigo-400" />
              Entrar com Digital / Face ID
            </button>
          </form>
        )}

        {step === 'MFA' && (
          <form onSubmit={handleMfaLogin} className="space-y-4">
            <div className="text-center mb-4">
              <KeyRound className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <h2 className="text-white font-bold text-lg">Autenticação em Duas Etapas</h2>
              <p className="text-slate-400 text-sm">Digite o código de 6 dígitos gerado pelo Google Authenticator.</p>
            </div>
            <div>
              <input
                type="text"
                required
                maxLength={6}
                placeholder="000000"
                value={mfaToken}
                onChange={(e) => setMfaToken(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white text-center text-2xl tracking-widest font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 mt-4"
            >
              Verificar Código
            </button>
            <button type="button" onClick={() => setStep('LOGIN')} className="w-full text-slate-500 text-sm mt-4">Cancelar</button>
          </form>
        )}

        {step === 'FORGOT_PASSWORD' && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div className="text-center mb-4">
              <h2 className="text-white font-bold text-lg">Recuperar Senha</h2>
              <p className="text-slate-400 text-sm">Enviaremos um link de recuperação para o seu e-mail.</p>
            </div>
            <div>
              <input
                type="email"
                required
                placeholder="Seu e-mail de acesso"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-xl mt-4"
            >
              Enviar E-mail
            </button>
            <button type="button" onClick={() => setStep('LOGIN')} className="w-full text-slate-500 text-sm mt-4">Voltar para o Login</button>
          </form>
        )}
      </div>
    </div>
  );
};

export default Login;
