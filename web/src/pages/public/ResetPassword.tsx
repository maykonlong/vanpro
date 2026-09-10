import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { AuthShell } from './AuthShell';
import { Button, InlineError, SuccessNote, TextInput } from '../../components/ui';
import { api } from '../../lib/api';
import { useAction } from '../../hooks/useResource';
import { passwordStrength } from '../../lib/validators';

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const action = useAction();
  const token = params.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);

  const strength = passwordStrength(newPassword);

  if (!token) {
    return (
      <AuthShell
        title="Link inválido"
        subtitle="Este endereço não traz um token de redefinição. Peça um novo link na tela de recuperação."
        footer={
          <Link to="/esqueci-a-senha" className="inline-flex min-h-[44px] items-center text-brand-600 underline">
            Pedir novo link
          </Link>
        }
      >
        <p className="text-sm text-ink-400">
          Links de redefinição valem por 15 minutos e só podem ser usados uma vez.
        </p>
      </AuthShell>
    );
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const errs: Record<string, string> = {};
    if (strength.problems.length) errs.newPassword = strength.problems.join(' · ');
    if (newPassword !== confirm) errs.confirm = 'As senhas não conferem.';
    setLocal(errs);
    if (Object.keys(errs).length) return;

    const result = await action.run(() =>
      api.post<{ message: string }>('/auth/reset-password', { token, newPassword }),
    );
    if (result) {
      setDone(result.message);
      setTimeout(() => navigate('/entrar', { replace: true }), 1500);
    }
  };

  return (
    <AuthShell title="Redefinir senha" subtitle="Escolha uma senha nova. Todas as sessões abertas serão encerradas.">
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <InlineError message={action.error} />
        <SuccessNote message={done} />

        <TextInput
          label="Nova senha"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          error={local.newPassword ?? action.fieldErrors.newPassword}
          hint="Mínimo de 12 caracteres, com maiúsculas, minúsculas e número."
        />
        <TextInput
          label="Repita a nova senha"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={local.confirm}
        />
        <Button type="submit" loading={action.pending}>
          Redefinir senha
        </Button>
      </form>
    </AuthShell>
  );
}
