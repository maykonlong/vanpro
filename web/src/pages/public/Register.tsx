import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AuthShell } from './AuthShell';
import { Button, InlineError, TextInput } from '../../components/ui';
import { api, setCsrfToken } from '../../lib/api';
import { useAction } from '../../hooks/useResource';
import { useAuth } from '../../context/AuthContext';
import { documentError, emailError, maskDocument, passwordStrength } from '../../lib/validators';

interface RegisterResponse {
  csrfToken: string;
}

export function Register() {
  const navigate = useNavigate();
  const { reload } = useAuth();
  const action = useAction();

  const [companyName, setCompanyName] = useState('');
  const [document, setDocument] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});

  const strength = passwordStrength(ownerPassword);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!companyName.trim()) errs.companyName = 'Informe o nome da empresa.';
    const docErr = documentError(document);
    if (docErr) errs.document = docErr;
    if (!ownerName.trim()) errs.ownerName = 'Informe o nome do responsável.';
    const mailErr = emailError(ownerEmail);
    if (mailErr) errs.ownerEmail = mailErr;
    if (strength.problems.length) errs.ownerPassword = strength.problems.join(' · ');
    setLocal(errs);
    return Object.keys(errs).length === 0;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validate()) return;

    const created = await action.run(async () => {
      const data = await api.post<RegisterResponse>('/register', {
        companyName: companyName.trim(),
        document: document.replace(/\D/g, ''),
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim(),
        ownerPassword,
      });
      setCsrfToken(data.csrfToken);
      await reload();
      return true;
    });

    if (created) navigate('/app/painel', { replace: true });
  };

  const fieldError = (name: string) => local[name] ?? action.fieldErrors[name];

  return (
    <AuthShell
      title="Cadastrar empresa"
      subtitle="Teste de 7 dias. Você vira o proprietário da conta e pode convidar a equipe depois."
      footer={
        <p>
          Já tem conta?{' '}
          <Link to="/entrar" className="text-brand-600 underline">
            Entrar
          </Link>
        </p>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <InlineError message={action.error} />

        <TextInput
          label="Nome da empresa"
          name="companyName"
          required
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          error={fieldError('companyName')}
        />
        <TextInput
          label="CPF ou CNPJ"
          name="document"
          inputMode="numeric"
          required
          hint="Conferimos o dígito verificador antes de enviar."
          value={document}
          onChange={(e) => setDocument(maskDocument(e.target.value))}
          error={fieldError('document')}
        />
        <TextInput
          label="Seu nome"
          name="ownerName"
          autoComplete="name"
          required
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          error={fieldError('ownerName')}
        />
        <TextInput
          label="Seu e-mail"
          name="ownerEmail"
          type="email"
          autoComplete="email"
          required
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          error={fieldError('ownerEmail')}
        />
        <TextInput
          label="Senha"
          name="ownerPassword"
          type="password"
          autoComplete="new-password"
          required
          value={ownerPassword}
          onChange={(e) => setOwnerPassword(e.target.value)}
          error={fieldError('ownerPassword')}
          hint="Mínimo de 12 caracteres, com maiúsculas, minúsculas e número."
        />

        {ownerPassword ? (
          <div>
            <div className="flex h-2 gap-1" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-full flex-1 rounded-full ${
                    i < strength.score ? 'bg-good-400' : 'bg-ink-700'
                  }`}
                />
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-400" aria-live="polite">
              Forca da senha: {strength.label}
              {strength.problems.length ? ` — falta: ${strength.problems.join(', ')}` : ''}
            </p>
          </div>
        ) : null}

        <Button type="submit" loading={action.pending}>
          Criar conta
        </Button>

        <p className="text-xs text-ink-400">
          Ao criar a conta você concorda com o tratamento de dados descrito na{' '}
          <Link to="/privacidade" className="text-brand-600 underline">
            Política de Privacidade
          </Link>
          .
        </p>
      </form>
    </AuthShell>
  );
}
