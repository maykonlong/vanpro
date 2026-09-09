import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';

import { AuthShell } from './AuthShell';
import { Button, InlineError, TextInput } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useAction } from '../../hooks/useResource';
import { homeForRole } from '../../lib/routes';

export function Login() {
  const { login, loginWithTwoFactor, loginWithPasskey, status, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const action = useAction();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');

  if (status === 'authenticated' && user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? homeForRole(user.role)} replace />;
  }

  const goHome = () => navigate('/app', { replace: true });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await action.run(() => login(email, password));
    if (!result) return;
    if (result.requires2FA && result.challengeId) {
      setChallengeId(result.challengeId);
      return;
    }
    goHome();
  };

  const onSubmitCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!challengeId) return;
    const done = await action.run(async () => {
      await loginWithTwoFactor(challengeId, code);
      return true;
    });
    if (done) goHome();
  };

  const onPasskey = async () => {
    const done = await action.run(async () => {
      await loginWithPasskey();
      return true;
    });
    if (done) goHome();
  };

  if (challengeId) {
    return (
      <AuthShell
        title="Verificação em duas etapas"
        subtitle="Digite o código do seu aplicativo autenticador ou um código de recuperação."
      >
        <form className="flex flex-col gap-4" onSubmit={onSubmitCode} noValidate>
          <InlineError message={action.error} />
          <TextInput
            label="Código"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={action.fieldErrors.code}
          />
          <Button type="submit" loading={action.pending}>
            Confirmar código
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setChallengeId(null);
              setCode('');
              action.reset();
            }}
          >
            Voltar para o login
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Entrar"
      subtitle="Use o e-mail cadastrado na sua empresa."
      footer={
        <p>
          Ainda não tem conta?{' '}
          <Link to="/cadastro" className="text-brand-400 underline">
            Cadastre sua empresa
          </Link>
        </p>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <InlineError message={action.error} />
        <TextInput
          label="E-mail"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={action.fieldErrors.email}
        />
        <TextInput
          label="Senha"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={action.fieldErrors.password}
        />
        <Button type="submit" loading={action.pending}>
          Entrar
        </Button>
      </form>

      <Button type="button" variant="secondary" onClick={() => void onPasskey()}>
        <KeyRound aria-hidden="true" size={18} />
        Entrar com passkey
      </Button>

      <Link to="/esqueci-a-senha" className="inline-flex min-h-[44px] items-center text-sm text-brand-400 underline">
        Esqueci minha senha
      </Link>
    </AuthShell>
  );
}
