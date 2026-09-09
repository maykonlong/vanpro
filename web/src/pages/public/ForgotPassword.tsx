import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { AuthShell } from './AuthShell';
import { Button, InlineError, SuccessNote, TextInput } from '../../components/ui';
import { api } from '../../lib/api';
import { useAction } from '../../hooks/useResource';

interface ForgotResponse {
  message: string;
  /** Presente apenas no ambiente local: nao ha provedor de e-mail configurado. */
  devLink?: string;
}

export function ForgotPassword() {
  const action = useAction();
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<ForgotResponse | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const data = await action.run(() =>
      api.post<ForgotResponse>('/auth/forgot-password', { email: email.trim() }),
    );
    if (data) setResult(data);
  };

  return (
    <AuthShell
      title="Esqueci minha senha"
      subtitle="Informe o e-mail da conta. A resposta é a mesma para e-mail cadastrado ou não — e assim que a tela deixa de ser um verificador de cadastro."
      footer={
        <Link to="/entrar" className="inline-flex min-h-[44px] items-center text-brand-400 underline">
          Voltar para o login
        </Link>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <InlineError message={action.error} />
        <SuccessNote message={result?.message ?? null} />

        {result?.devLink ? (
          <p className="rounded-lg border border-warn-400/40 bg-amber-950/40 px-3 py-2 text-sm text-warn-400">
            Ambiente local sem provedor de e-mail. Link de redefinição:{' '}
            <a className="underline" href={result.devLink}>
              abrir redefinição
            </a>
          </p>
        ) : null}

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
        <Button type="submit" loading={action.pending}>
          Enviar instruções
        </Button>
      </form>
    </AuthShell>
  );
}
