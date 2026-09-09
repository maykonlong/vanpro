import { useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarRange } from 'lucide-react';

import { api } from '../../lib/api';
import { formatDateTime, label, parseBrlToCents } from '../../lib/format';
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
  TextInput,
} from '../../components/ui';
import type { Charter, CharterStatus, Driver, Paginated, Vehicle } from '../../lib/types';

/** Transicoes aceitas pelo servidor. O botao segue o mesmo mapa. */
const TRANSICOES: Record<CharterStatus, CharterStatus[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELED'],
  COMPLETED: [],
  CANCELED: [],
};

/** `datetime-local` quer `YYYY-MM-DDTHH:mm` no fuso local. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Charters() {
  const { hasPermission } = useAuth();
  const podeGerir = hasPermission('canManageRoutes');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Charter | null>(null);
  const [assigning, setAssigning] = useState<Charter | null>(null);
  const [removing, setRemoving] = useState<Charter | null>(null);

  const [title, setTitle] = useState('');
  const [contractor, setContractor] = useState('');
  const [price, setPrice] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');

  const list = useResource<Paginated<Charter>>(
    (signal) => api.get('/charters', { page, perPage: 20, status }, signal),
    [page, status],
  );
  const veiculos = useResource<Paginated<Vehicle>>(
    (signal) => api.get('/vehicles', { perPage: 100 }, signal),
    [],
  );
  const motoristas = useResource<Paginated<Driver>>(
    (signal) => api.get('/drivers', { perPage: 100, status: 'ACTIVE' }, signal),
    [],
  );

  const save = useAction();
  const assign = useAction();
  const changeStatus = useAction();
  const remove = useAction();

  const openCreate = () => {
    setTitle('');
    setContractor('');
    setPrice('');
    setStartDate('');
    setEndDate('');
    save.reset();
    setCreating(true);
  };

  const openEdit = (charter: Charter) => {
    setTitle(charter.title);
    setContractor(charter.contractor);
    setPrice((charter.price.cents / 100).toFixed(2).replace('.', ','));
    setStartDate(toLocalInput(charter.startDate));
    setEndDate(toLocalInput(charter.endDate));
    save.reset();
    setEditing(charter);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const cents = parseBrlToCents(price);
    if (cents === null) return;

    const payload = {
      title: title.trim(),
      contractor: contractor.trim(),
      price: cents / 100,
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
    };

    const done = await save.run(async () => {
      if (editing) await api.patch<Charter>(`/charters/${editing.id}`, payload);
      else await api.post<Charter>('/charters', payload);
      return true;
    });

    if (done) {
      setCreating(false);
      setEditing(null);
      list.reload();
    }
  };

  const onAssign = async (event: FormEvent) => {
    event.preventDefault();
    if (!assigning) return;
    const done = await assign.run(async () => {
      await api.post(`/charters/${assigning.id}/assign`, { vehicleId, driverId });
      return true;
    });
    if (done) {
      setAssigning(null);
      list.reload();
    }
  };

  const onStatus = async (charter: Charter, next: CharterStatus) => {
    const done = await changeStatus.run(async () => {
      await api.post(`/charters/${charter.id}/status`, { status: next });
      return true;
    });
    if (done) list.reload();
  };

  const onDelete = async () => {
    if (!removing) return;
    const done = await remove.run(async () => {
      await api.del(`/charters/${removing.id}`);
      return true;
    });
    if (done) {
      setRemoving(null);
      list.reload();
    }
  };

  if (!podeGerir) {
    return (
      <div>
        <PageHeader title="Fretamentos" />
        <PermissionNotice area="Fretamentos" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Fretamentos"
        description="Agenda dos contratos avulsos. A atribuição confere sobreposição de veículo e motorista dentro de transação."
        actions={<Button onClick={openCreate}>Novo fretamento</Button>}
      />

      <Card className="mb-4">
        <div className="w-56">
          <SelectInput
            label="Situação"
            name="status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            <option value="PENDING">Agendado</option>
            <option value="IN_PROGRESS">Em andamento</option>
            <option value="COMPLETED">Concluído</option>
            <option value="CANCELED">Cancelado</option>
          </SelectInput>
        </div>
      </Card>

      <InlineError message={changeStatus.error} />

      {list.loading ? <SkeletonList rows={4} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<CalendarRange size={30} />}
          title="Nenhum fretamento na agenda"
          description="Cadastre o contrato com data de início e fim; depois atribua veículo e motorista. Conflito de escala é recusado com a explicação de qual contrato já ocupa o recurso."
          action={<Button onClick={openCreate}>Cadastrar fretamento</Button>}
        />
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((c) => (
              <li key={c.id}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-ink-50">{c.title}</p>
                      <p className="text-xs text-ink-400">
                        {c.contractor} · {formatDateTime(c.startDate)} até {formatDateTime(c.endDate)}
                      </p>
                      <p className="mt-1 text-sm text-ink-200">{c.price.formatted}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          c.status === 'COMPLETED'
                            ? 'good'
                            : c.status === 'CANCELED'
                              ? 'bad'
                              : c.status === 'IN_PROGRESS'
                                ? 'warn'
                                : 'neutral'
                        }
                      >
                        {label.charterStatus(c.status)}
                      </Badge>
                      <Badge tone={c.vehicleId && c.driverId ? 'good' : 'warn'}>
                        {c.vehicleId && c.driverId ? 'Escalado' : 'Sem escala'}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setVehicleId(c.vehicleId ?? '');
                        setDriverId(c.driverId ?? '');
                        assign.reset();
                        setAssigning(c);
                      }}
                      disabled={c.status === 'COMPLETED' || c.status === 'CANCELED'}
                    >
                      Atribuir
                    </Button>
                    <Button variant="secondary" onClick={() => openEdit(c)}>
                      Editar
                    </Button>
                    {TRANSICOES[c.status].map((next) => (
                      <Button
                        key={next}
                        variant={next === 'CANCELED' ? 'danger' : 'primary'}
                        loading={changeStatus.pending}
                        onClick={() => void onStatus(c, next)}
                      >
                        {next === 'IN_PROGRESS'
                          ? 'Iniciar'
                          : next === 'COMPLETED'
                            ? 'Concluir'
                            : 'Cancelar'}
                      </Button>
                    ))}
                    <Button variant="ghost" onClick={() => setRemoving(c)}>
                      Excluir
                    </Button>
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

      <Modal
        open={creating || editing !== null}
        title={editing ? 'Editar fretamento' : 'Novo fretamento'}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      >
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <InlineError message={save.error} />
          <TextInput
            label="Título"
            name="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={save.fieldErrors.title}
          />
          <TextInput
            label="Contratante"
            name="contractor"
            required
            value={contractor}
            onChange={(e) => setContractor(e.target.value)}
            error={save.fieldErrors.contractor}
          />
          <TextInput
            label="Preço (R$)"
            name="price"
            inputMode="decimal"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            error={save.fieldErrors.price}
          />
          <TextInput
            label="Início"
            name="startDate"
            type="datetime-local"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            error={save.fieldErrors.startDate}
          />
          <TextInput
            label="Fim"
            name="endDate"
            type="datetime-local"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            error={save.fieldErrors.endDate}
            hint="Precisa ser posterior ao início e no máximo 60 dias depois."
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={save.pending}>
              {editing ? 'Salvar' : 'Cadastrar'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={assigning !== null}
        title={assigning ? `Atribuir "${assigning.title}"` : 'Atribuir'}
        onClose={() => setAssigning(null)}
      >
        <form className="flex flex-col gap-4" onSubmit={onAssign} noValidate>
          <InlineError message={assign.error} />
          <SelectInput
            label="Veículo"
            name="vehicleId"
            required
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            error={assign.fieldErrors.vehicleId}
          >
            <option value="">Selecione</option>
            {(veiculos.data?.items ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate} — {v.model}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            label="Motorista"
            name="driverId"
            required
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            error={assign.fieldErrors.driverId}
          >
            <option value="">Selecione</option>
            {(motoristas.data?.items ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectInput>
          <p className="text-xs text-ink-400">
            Se o veículo ou o motorista já estiverem escalados num período que se sobrepõe, o
            servidor recusa e diz qual contrato ocupa o recurso.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setAssigning(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={assign.pending}>
              Atribuir
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title="Excluir fretamento"
        message={
          removing
            ? `Excluir "${removing.title}"? Contratos em andamento ou concluídos costumam ser recusados pelo servidor, para não apagar histórico faturado.`
            : ''
        }
        confirmLabel="Excluir"
        loading={remove.pending}
        onConfirm={() => void onDelete()}
        onCancel={() => {
          setRemoving(null);
          remove.reset();
        }}
      />
      <InlineError message={remove.error} />
    </div>
  );
}
