import { useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound, MonitorSmartphone } from 'lucide-react';

import { api } from '../../lib/api';
import { formatDateTime, label } from '../../lib/format';
import { useAction, useResource } from '../../hooks/useResource';
import { useAuth } from '../../context/AuthContext';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  InlineError,
  PageHeader,
  SkeletonList,
  SuccessNote,
  TextInput,
} from '../../components/ui';
import { passwordStrength } from '../../lib/validators';
import type { CompanyProfile, FeatureFlags, SessionInfo } from '../../lib/types';

function Plano() {
  const perfil = useResource<CompanyProfile>((signal) => api.get('/company/me', undefined, signal), []);

  if (perfil.loading) return <SkeletonList rows={2} />;
  if (perfil.error) return <ErrorState message={perfil.error} onRetry={perfil.reload} />;
  if (!perfil.data) return null;

  const { company, plan } = perfil.data;
  const linhas = [
    ['Veículos', plan.usage.vehicles],
    ['Motoristas', plan.usage.drivers],
    ['Alunos', plan.usage.students],
  ] as const;

  return (
    <Card>
      <h2 className="text-base font-semibold text-ink-50">Plano e uso da frota ativa</h2>
      <p className="mt-1 text-sm text-ink-400">
        <span data-testid="empresa-configuracoes" className="font-medium text-ink-200">
          {company.name}
        </span>{' '}
        · plano {plan.plan} · situação {label.subscriptionStatus(plan.status)}
        {plan.trialEndsAt ? ` · teste até ${formatDateTime(plan.trialEndsAt)}` : ''}
      </p>

      <ul className="mt-4 flex flex-col gap-3">
        {linhas.map(([titulo, uso]) => {
          const pct = uso.limit > 0 ? Math.min(100, Math.round((uso.used / uso.limit) * 100)) : 0;
          return (
            <li key={titulo}>
              <div className="flex justify-between text-sm">
                <span className="text-ink-200">{titulo}</span>
                <span className="text-ink-400">
                  {uso.used} de {uso.limit}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-ink-800" aria-hidden="true">
                <div
                  className={`h-2 rounded-full ${pct >= 100 ? 'bg-bad-500' : 'bg-brand-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Integracoes() {
  const flags = useResource<FeatureFlags>((signal) => api.get('/health/features', undefined, signal), []);

  return (
    <Card>
      <h2 className="text-base font-semibold text-ink-50">Integrações</h2>
      <p className="mt-1 text-sm text-ink-400">
        O que está realmente ligado neste ambiente. Integração desligada recusa a operação em vez de
        simular sucesso.
      </p>
      {flags.loading ? <SkeletonList rows={1} /> : null}
      {flags.error ? <ErrorState message={flags.error} onRetry={flags.reload} /> : null}
      {flags.data ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ['Cobrança', flags.data.billing],
              ['WhatsApp', flags.data.whatsapp],
            ] as const
          ).map(([nome, ligado]) => (
            <li key={nome}>
              <Badge tone={ligado ? 'good' : 'neutral'}>
                {nome}: {ligado ? 'configurada' : 'não configurada'}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function Sessoes() {
  const list = useResource<{ items: SessionInfo[] }>(
    (signal) => api.get('/auth/sessions', undefined, signal),
    [],
  );
  const revoke = useAction();
  const [alvo, setAlvo] = useState<SessionInfo | null>(null);

  const onRevoke = async () => {
    if (!alvo) return;
    const done = await revoke.run(async () => {
      await api.del(`/auth/sessions/${alvo.id}`);
      return true;
    });
    if (done) {
      setAlvo(null);
      list.reload();
    }
  };

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink-50">
        <MonitorSmartphone aria-hidden="true" size={18} /> Dispositivos conectados
      </h2>

      {list.loading ? <SkeletonList rows={2} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data ? (
        <ul className="mt-3 flex flex-col gap-2">
          {list.data.items.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-ink-800 px-3 py-2">
              <div>
                <p className="text-sm text-ink-50">{s.ipAddress ?? 'IP não registrado'}</p>
                <p className="text-xs text-ink-400">Desde {formatDateTime(s.createdAt)}</p>
              </div>
              {s.current ? (
                <Badge tone="good">Este dispositivo</Badge>
              ) : (
                <Button variant="danger" onClick={() => setAlvo(s)}>
                  Encerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <ConfirmDialog
        open={alvo !== null}
        title="Encerrar sessão"
        message="Encerrar este dispositivo? A família inteira de tokens dele é revogada — quem estiver usando precisa entrar de novo."
        confirmLabel="Encerrar"
        loading={revoke.pending}
        onConfirm={() => void onRevoke()}
        onCancel={() => {
          setAlvo(null);
          revoke.reset();
        }}
      />
      <InlineError message={revoke.error} />
    </Card>
  );
}

interface TwoFactorSetup {
  secret: string;
  otpauth: string;
  qrCode: string;
}

function DoisFatores() {
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  const iniciar = useAction();
  const ativar = useAction();
  const desativar = useAction();

  const onSetup = async () => {
    setAviso(null);
    const data = await iniciar.run(() => api.post<TwoFactorSetup>('/auth/2fa/setup'));
    if (data) setSetup(data);
  };

  const onActivate = async (event: FormEvent) => {
    event.preventDefault();
    const data = await ativar.run(() =>
      api.post<{ recoveryCodes: string[]; message: string }>('/auth/2fa/activate', { code }),
    );
    if (data) {
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setCode('');
    }
  };

  const onDisable = async (event: FormEvent) => {
    event.preventDefault();
    const data = await desativar.run(() =>
      api.post<{ message: string }>('/auth/2fa/disable', { password, code: disableCode }),
    );
    if (data) {
      setAviso(data.message);
      setDisabling(false);
      setPassword('');
      setDisableCode('');
    }
  };

  return (
    <Card>
      <h2 className="text-base font-semibold text-ink-50">Verificação em duas etapas</h2>
      <p className="mt-1 text-sm text-ink-400">
        Um segundo fator no login. Para desligar são exigidos a senha E o código: assim um cookie
        roubado não vira a chave para remover a própria proteção.
      </p>

      <SuccessNote message={aviso} />

      {recoveryCodes ? (
        <div className="mt-4 rounded-lg border border-warn-400/40 bg-warn-soft p-3">
          <p className="text-sm font-semibold text-warn-400">
            Guarde estes códigos agora. Eles não serão exibidos novamente.
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm text-ink-50">
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button className="mt-3" variant="secondary" onClick={() => setRecoveryCodes(null)}>
            Já anotei
          </Button>
        </div>
      ) : null}

      {setup ? (
        <form className="mt-4 flex flex-col gap-3" onSubmit={onActivate} noValidate>
          <InlineError message={ativar.error} />
          <img
            src={setup.qrCode}
            alt="QR Code para cadastrar a verificação em duas etapas no aplicativo autenticador"
            className="h-40 w-40 rounded-lg bg-white p-2"
          />
          <p className="break-all text-xs text-ink-400">
            Código manual: <span className="font-mono text-ink-200">{setup.secret}</span>
          </p>
          <TextInput
            label="Código do aplicativo"
            name="code"
            inputMode="numeric"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={ativar.fieldErrors.code}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={ativar.pending}>
              Ativar 2FA
            </Button>
            <Button type="button" variant="secondary" onClick={() => setSetup(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}

      {!setup ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button loading={iniciar.pending} onClick={() => void onSetup()}>
            Ativar verificação em duas etapas
          </Button>
          <Button variant="secondary" onClick={() => setDisabling(true)}>
            Desativar
          </Button>
        </div>
      ) : null}

      <InlineError message={iniciar.error} />

      {disabling ? (
        <form className="mt-4 flex flex-col gap-3" onSubmit={onDisable} noValidate>
          <InlineError message={desativar.error} />
          <TextInput
            label="Sua senha"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={desativar.fieldErrors.password}
          />
          <TextInput
            label="Código do aplicativo ou de recuperação"
            name="disableCode"
            required
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            error={desativar.fieldErrors.code}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" loading={desativar.pending}>
              Confirmar desativação
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDisabling(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function Passkeys() {
  const { registerPasskey } = useAuth();
  const action = useAction();
  const [ok, setOk] = useState<string | null>(null);

  const onRegister = async () => {
    setOk(null);
    const done = await action.run(async () => {
      await registerPasskey();
      return true;
    });
    if (done) setOk('Passkey registrada neste dispositivo.');
  };

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink-50">
        <KeyRound aria-hidden="true" size={18} /> Passkeys
      </h2>
      <p className="mt-1 text-sm text-ink-400">
        Entrada sem senha usando a biometria ou o PIN do dispositivo. O servidor guarda apenas a
        chave pública.
      </p>
      <SuccessNote message={ok} />
      <InlineError message={action.error} />
      <Button className="mt-3" loading={action.pending} onClick={() => void onRegister()}>
        Registrar passkey neste dispositivo
      </Button>
    </Card>
  );
}

function TrocarSenha() {
  const action = useAction();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  const [local, setLocal] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const strength = passwordStrength(newPassword);
    setLocal(strength.problems.length ? strength.problems.join(' · ') : null);
    if (strength.problems.length) return;

    setOk(null);
    const data = await action.run(() =>
      api.post<{ message: string }>('/auth/change-password', { currentPassword, newPassword }),
    );
    if (data) {
      setOk(data.message);
      setCurrentPassword('');
      setNewPassword('');
    }
  };

  return (
    <Card>
      <h2 className="text-base font-semibold text-ink-50">Trocar senha</h2>
      <p className="mt-1 text-sm text-ink-400">
        Trocar a senha derruba as demais sessões; esta continua ativa.
      </p>
      <form className="mt-3 flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <InlineError message={action.error} />
        <SuccessNote message={ok} />
        <TextInput
          label="Senha atual"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          error={action.fieldErrors.currentPassword}
        />
        <TextInput
          label="Nova senha"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          error={local ?? action.fieldErrors.newPassword}
        />
        <div className="flex justify-end">
          <Button type="submit" loading={action.pending}>
            Trocar senha
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function Settings() {
  const { user, hasRole, companies } = useAuth();
  // `/company/me` e restrito aos papeis de operacao; responsavel e super admin
  // nao tem empresa vinculada nessa rota.
  const temEmpresa = hasRole('OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT');
  const frotaAtiva = user?.company?.name ?? null;

  return (
    <div>
      <PageHeader
        title="Configurações"
        description={`${user?.name ?? ''} · ${user?.email ?? ''}`}
      />

      {frotaAtiva ? (
        <p className="mb-4 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-sm text-ink-300">
          Os dados de empresa desta página são da <strong className="text-ink-50">frota ativa</strong>
          {': '}
          <strong className="text-ink-50">{frotaAtiva}</strong>
          {companies.length > 1
            ? ' · você atende mais de uma frota; troque no seletor do cabeçalho.'
            : ''}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {temEmpresa ? <Plano /> : null}
        <Integracoes />
        <DoisFatores />
        <Passkeys />
        <Sessoes />
        <TrocarSenha />
      </div>
    </div>
  );
}
