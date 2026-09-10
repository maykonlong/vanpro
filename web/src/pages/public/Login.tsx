import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Building2, KeyRound } from 'lucide-react';

import { AuthShell } from './AuthShell';
import { Button, InlineError, TextInput } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import type { LoginResult } from '../../context/AuthContext';
import { useAction } from '../../hooks/useResource';
import { label } from '../../lib/format';
import { homeForRole } from '../../lib/routes';
import type { CompanyMembership } from '../../lib/types';

/** Passo de escolha de frota: a credencial já passou, falta dizer onde operar. */
interface EscolhaDeEmpresa {
  selectionToken: string;
  companies: CompanyMembership[];
}

export function Login() {
  const { login, loginWithTwoFactor, loginWithPasskey, selectCompany, status, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const action = useAction();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [escolha, setEscolha] = useState<EscolhaDeEmpresa | null>(null);
  const [empresaId, setEmpresaId] = useState('');

  if (status === 'authenticated' && user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? homeForRole(user.role)} replace />;
  }

  const goHome = () => navigate('/app', { replace: true });

  /**
   * Desfecho comum às três formas de entrar. Com mais de um vínculo a API não
   * emite sessão: mostra o passo de escolha em vez de navegar.
   */
  const seguirApos = (result: LoginResult): void => {
    if (result.requiresCompanySelection && result.selectionToken) {
      setEscolha({ selectionToken: result.selectionToken, companies: result.companies ?? [] });
      // Sugestão pré-selecionada (última frota usada), nunca escolha automática.
      setEmpresaId(result.suggestedCompanyId ?? '');
      return;
    }
    goHome();
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await action.run(() => login(email, password));
    if (!result) return;
    if (result.requires2FA && result.challengeId) {
      setChallengeId(result.challengeId);
      return;
    }
    seguirApos(result);
  };

  const onSubmitCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!challengeId) return;
    const result = await action.run(() => loginWithTwoFactor(challengeId, code));
    if (result) seguirApos(result);
  };

  const onPasskey = async () => {
    const result = await action.run(() => loginWithPasskey());
    if (result) seguirApos(result);
  };

  const onEscolherEmpresa = async (event: FormEvent) => {
    event.preventDefault();
    if (!escolha || !empresaId) return;
    const done = await action.run(async () => {
      await selectCompany(escolha.selectionToken, empresaId);
      return true;
    });
    if (done) goHome();
  };

  const voltarParaLogin = () => {
    setEscolha(null);
    setEmpresaId('');
    setChallengeId(null);
    setCode('');
    setPassword('');
    action.reset();
  };

  if (escolha) {
    return (
      <AuthShell
        title="Em qual frota você vai operar?"
        subtitle="Você tem vínculo ativo com mais de uma empresa. A frota escolhida define tudo que você vai ver e registrar nesta sessão — e você pode trocá-la depois, no cabeçalho."
      >
        <form className="flex flex-col gap-4" onSubmit={onEscolherEmpresa} noValidate>
          <InlineError message={action.error} />

          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Escolha a frota</legend>
            {escolha.companies.map((empresa) => (
              <label
                key={empresa.companyId}
                className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  empresaId === empresa.companyId
                    ? 'border-brand-500 bg-ink-800'
                    : 'border-ink-700 hover:bg-ink-800'
                }`}
              >
                <input
                  type="radio"
                  name="empresa"
                  value={empresa.companyId}
                  checked={empresaId === empresa.companyId}
                  onChange={() => setEmpresaId(empresa.companyId)}
                  className="h-5 w-5 shrink-0 accent-brand-500"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-50">
                    {empresa.companyName}
                  </span>
                  <span className="block text-xs text-ink-400">
                    Seu papel aqui: {label.role(empresa.role)}
                    {empresa.status === 'ARCHIVED' ? ' · vínculo arquivado (só leitura)' : ''}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <Button type="submit" loading={action.pending} disabled={!empresaId}>
            <Building2 aria-hidden="true" size={18} />
            Entrar nesta frota
          </Button>
          <Button type="button" variant="ghost" onClick={voltarParaLogin}>
            Voltar para o login
          </Button>
        </form>
      </AuthShell>
    );
  }

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
          <Link to="/cadastro" className="text-brand-600 underline">
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

      <Link to="/esqueci-a-senha" className="inline-flex min-h-[44px] items-center text-sm text-brand-600 underline">
        Esqueci minha senha
      </Link>
    </AuthShell>
  );
}
