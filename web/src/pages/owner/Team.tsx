import { useState } from 'react';
import type { FormEvent } from 'react';
import { UsersRound } from 'lucide-react';

import { api } from '../../lib/api';
import { formatDate, label } from '../../lib/format';
import { useAction, useResource } from '../../hooks/useResource';
import { useAuth } from '../../context/AuthContext';
import { PermissionNotice } from '../../components/PermissionNotice';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  InlineError,
  Modal,
  PageHeader,
  Pagination,
  SelectInput,
  SkeletonList,
  SuccessNote,
  TextInput,
} from '../../components/ui';
import type { Paginated, Permissions, Role, TeamMember } from '../../lib/types';

const PAPEIS: Role[] = ['OWNER', 'MANAGER', 'DRIVER', 'ASSISTANT', 'PARENT'];

const FLAGS: Array<{ key: keyof Permissions; texto: string; explica: string }> = [
  {
    key: 'canManageFinance',
    texto: 'Financeiro',
    explica: 'DRE, mensalidades, despesas e faturas.',
  },
  { key: 'canManageHR', texto: 'Pessoas', explica: 'Motoristas, convites e desligamento.' },
  {
    key: 'canManageRoutes',
    texto: 'Rotas',
    explica: 'Alunos, veículos e escala de fretamento.',
  },
];

interface InviteResponse {
  member: TeamMember;
  emailSent: boolean;
  inviteExpiresAt: string;
  /** So existe no ambiente local: nao ha provedor de e-mail configurado. */
  inviteLink?: string;
}

export function Team() {
  const { user, hasPermission } = useAuth();
  const ehDono = user?.role === 'OWNER';
  const podeConvidar = hasPermission('canManageHR');

  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [archiving, setArchiving] = useState<TeamMember | null>(null);
  const [inviteInfo, setInviteInfo] = useState<InviteResponse | null>(null);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('DRIVER');
  const [contractType, setContractType] = useState<'FULL_TIME' | 'FREELANCE'>('FULL_TIME');
  const [permissions, setPermissions] = useState<Permissions>({
    canManageFinance: false,
    canManageHR: false,
    canManageRoutes: false,
  });

  const [editRole, setEditRole] = useState<Role>('MANAGER');
  const [editPerms, setEditPerms] = useState<Permissions>({
    canManageFinance: false,
    canManageHR: false,
    canManageRoutes: false,
  });

  const list = useResource<Paginated<TeamMember>>(
    (signal) => api.get('/company/team', { page, perPage: 20 }, signal),
    [page],
  );
  const invite = useAction();
  const savePerms = useAction();
  const archive = useAction();

  const onInvite = async (event: FormEvent) => {
    event.preventDefault();
    const result = await invite.run(() =>
      api.post<InviteResponse>('/company/team/invite', {
        email: email.trim(),
        name: name.trim(),
        role,
        contractType,
        permissions,
      }),
    );
    if (result) {
      setInviteInfo(result);
      setInviting(false);
      setEmail('');
      setName('');
      list.reload();
    }
  };

  const openEdit = (member: TeamMember) => {
    setEditRole(member.role);
    setEditPerms(member.permissions);
    savePerms.reset();
    setEditing(member);
  };

  const onSavePerms = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const done = await savePerms.run(async () => {
      await api.post(`/company/team/${editing.id}/permissions`, {
        role: editRole,
        canManageFinance: editPerms.canManageFinance,
        canManageHR: editPerms.canManageHR,
        canManageRoutes: editPerms.canManageRoutes,
      });
      return true;
    });
    if (done) {
      setEditing(null);
      list.reload();
    }
  };

  const onArchive = async () => {
    if (!archiving) return;
    const done = await archive.run(async () => {
      await api.post(`/company/team/${archiving.id}/archive`);
      return true;
    });
    if (done) {
      setArchiving(null);
      list.reload();
    }
  };

  return (
    <div>
      <PageHeader
        title="Equipe"
        description="Convites, papel de cada pessoa e as três permissões que abrem as áreas do sistema."
        actions={podeConvidar ? <Button onClick={() => setInviting(true)}>Convidar</Button> : undefined}
      />

      {!podeConvidar && !ehDono ? (
        <div className="mb-4">
          <PermissionNotice area="Equipe" flag="canManageHR" />
        </div>
      ) : null}

      {inviteInfo ? (
        <div className="mb-4 flex flex-col gap-2">
          <SuccessNote
            message={`Convite criado para ${inviteInfo.member.email}, válido até ${formatDate(inviteInfo.inviteExpiresAt)}.`}
          />
          {!inviteInfo.emailSent ? (
            <p className="rounded-lg border border-warn-400/40 bg-warn-soft px-3 py-2 text-sm text-warn-400">
              Não há provedor de e-mail configurado neste ambiente: o convite NÃO foi enviado.
              Entregue o link manualmente.
              {inviteInfo.inviteLink ? (
                <>
                  {' '}
                  <a className="underline" href={inviteInfo.inviteLink}>
                    Abrir link do convite
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {list.loading ? <SkeletonList rows={4} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<UsersRound size={30} />}
          title="Você é a única pessoa na conta"
          description="Convide motoristas, monitores e gestores. Cada um entra com o próprio acesso, e você escolhe exatamente o que cada papel enxerga."
          action={podeConvidar ? <Button onClick={() => setInviting(true)}>Convidar alguém</Button> : undefined}
        />
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((m) => (
              <li key={m.id}>
                <Card className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink-50">{m.name}</p>
                    <p className="text-xs text-ink-400">
                      {m.email} · {label.role(m.role)}
                      {m.status === 'INVITED' && m.inviteExpiresAt
                        ? ` · convite até ${formatDate(m.inviteExpiresAt)}`
                        : ''}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      {FLAGS.filter((f) => m.permissions[f.key]).map((f) => (
                        <Badge key={f.key} tone="good">
                          {f.texto}
                        </Badge>
                      ))}
                      {FLAGS.every((f) => !m.permissions[f.key]) ? (
                        <span className="text-xs text-ink-400">Sem permissões especiais</span>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={m.status === 'ACTIVE' ? 'good' : m.status === 'INVITED' ? 'warn' : 'neutral'}>
                      {label.membershipStatus(m.status)}
                    </Badge>
                    {ehDono && m.userId !== user?.id ? (
                      <>
                        <Button variant="secondary" onClick={() => openEdit(m)}>
                          Permissões
                        </Button>
                        {m.status !== 'ARCHIVED' ? (
                          <Button variant="danger" onClick={() => setArchiving(m)}>
                            Arquivar
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination
            page={list.data.meta.page}
            totalPages={list.data.meta.totalPages}
            total={list.data.meta.total}
            onChange={setPage}
          />
        </>
      ) : null}

      <Modal open={inviting} title="Convidar para a equipe" onClose={() => setInviting(false)}>
        <form className="flex flex-col gap-4" onSubmit={onInvite} noValidate>
          <InlineError message={invite.error} />
          <TextInput
            label="Nome"
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={invite.fieldErrors.name}
          />
          <TextInput
            label="E-mail"
            name="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={invite.fieldErrors.email}
          />
          <SelectInput
            label="Papel"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            error={invite.fieldErrors.role}
          >
            {PAPEIS.map((r) => (
              <option key={r} value={r}>
                {label.role(r)}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            label="Contrato"
            name="contractType"
            value={contractType}
            onChange={(e) => setContractType(e.target.value as 'FULL_TIME' | 'FREELANCE')}
          >
            <option value="FULL_TIME">{label.contractType('FULL_TIME')}</option>
            <option value="FREELANCE">{label.contractType('FREELANCE')}</option>
          </SelectInput>

          <fieldset className="flex flex-col gap-3 rounded-lg border border-ink-700 p-3">
            <legend className="px-1 text-sm font-medium text-ink-200">Permissões</legend>
            {FLAGS.map((f) => (
              <label key={f.key} className="flex items-start gap-3 text-sm text-ink-200">
                <input
                  type="checkbox"
                  name={f.key}
                  checked={permissions[f.key]}
                  onChange={(e) => setPermissions({ ...permissions, [f.key]: e.target.checked })}
                />
                <span>
                  {f.texto}
                  <span className="block text-xs text-ink-400">{f.explica}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setInviting(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={invite.pending}>
              Enviar convite
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        title={editing ? `Permissões de ${editing.name}` : 'Permissões'}
        onClose={() => setEditing(null)}
      >
        <form className="flex flex-col gap-4" onSubmit={onSavePerms} noValidate>
          <InlineError message={savePerms.error} />
          <SelectInput
            label="Papel"
            name="editRole"
            value={editRole}
            onChange={(e) => setEditRole(e.target.value as Role)}
            error={savePerms.fieldErrors.role}
          >
            {PAPEIS.map((r) => (
              <option key={r} value={r}>
                {label.role(r)}
              </option>
            ))}
          </SelectInput>

          <fieldset className="flex flex-col gap-3 rounded-lg border border-ink-700 p-3">
            <legend className="px-1 text-sm font-medium text-ink-200">Permissões</legend>
            {FLAGS.map((f) => (
              <label key={f.key} className="flex items-start gap-3 text-sm text-ink-200">
                <input
                  type="checkbox"
                  name={`edit-${f.key}`}
                  checked={editPerms[f.key]}
                  onChange={(e) => setEditPerms({ ...editPerms, [f.key]: e.target.checked })}
                />
                <span>
                  {f.texto}
                  <span className="block text-xs text-ink-400">{f.explica}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <p className="text-xs text-ink-400">
            Esconder o menu é conforto: o servidor recusa a ação mesmo se a URL for digitada na mão.
          </p>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={savePerms.pending}>
              Salvar permissões
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={archiving !== null}
        title="Arquivar vínculo"
        message={
          archiving
            ? `Arquivar o acesso de ${archiving.name}? As sessões abertas dessa pessoa são derrubadas imediatamente.`
            : ''
        }
        confirmLabel="Arquivar"
        loading={archive.pending}
        onConfirm={() => void onArchive()}
        onCancel={() => {
          setArchiving(null);
          archive.reset();
        }}
      />
      <InlineError message={archive.error} />
    </div>
  );
}
