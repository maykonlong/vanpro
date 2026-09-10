import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { AuthShell } from './AuthShell';
import { Button, InlineError, TextInput } from '../../components/ui';
import { api, setCsrfToken } from '../../lib/api';
import { useAction } from '../../hooks/useResource';
import { useAuth } from '../../context/AuthContext';
import { passwordStrength } from '../../lib/validators';

export function AcceptInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { reload } = useAuth();
  const action = useAction();
  const token = params.get('token') ?? '';

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});

  const strength = passwordStrength(password);

  if (!token) {
    return (
      <AuthShell
        title="Convite inválido"
        subtitle="Este endereço não traz um token de convite. Peça a empresa que reenvie o link."
        footer={
          <Link to="/entrar" className="inline-flex min-h-[44px] items-center text-brand-600 underline">
            Ir para o login
          </Link>
        }
      >
        <p className="text-sm text-ink-400">Convites valem por 72 horas e são de uso único.</p>
      </AuthShell>
    );
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Informe seu nome.';
    if (strength.problems.length) errs.password = strength.problems.join(' · ');
    if (password !== confirm) errs.confirm = 'As senhas não conferem.';
    setLocal(errs);
    if (Object.keys(errs).length) return;

    const ok = await action.run(async () => {
      const data = await api.post<{ csrfToken: string }>('/company/accept-invite', {
        token,
        name: name.trim(),
        password,
      });
      setCsrfToken(data.csrfToken);
      await reload();
      return true;
    });

    if (ok) navigate('/app', { replace: true });
  };

  return (
    <AuthShell
      title="Aceitar convite"
      subtitle="Defina seu nome e sua senha para ativar o acesso à empresa que convidou você."
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <InlineError message={action.error} />
        <TextInput
          label="Seu nome"
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={local.name ?? action.fieldErrors.name}
        />
        <TextInput
          label="Senha"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={local.password ?? action.fieldErrors.password}
          hint="Mínimo de 12 caracteres, com maiúsculas, minúsculas e número."
        />
        <TextInput
          label="Repita a senha"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={local.confirm}
        />
        <Button type="submit" loading={action.pending}>
          Ativar meu acesso
        </Button>
      </form>
    </AuthShell>
  );
}
