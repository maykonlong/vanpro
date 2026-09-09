import { useState } from 'react';
import type { FormEvent } from 'react';
import { Bus, User } from 'lucide-react';

import { api } from '../../lib/api';
import { label, parseBrlToCents } from '../../lib/format';
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
import { plateError } from '../../lib/validators';
import type { Driver, Paginated, Shift, Vehicle, VehicleStatus } from '../../lib/types';

function Veiculos() {
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [removing, setRemoving] = useState<Vehicle | null>(null);
  const [odometro, setOdometro] = useState<Vehicle | null>(null);

  const [plate, setPlate] = useState('');
  const [model, setModel] = useState('');
  const [capacity, setCapacity] = useState('15');
  const [status, setStatus] = useState<VehicleStatus>('IDLE');
  const [km, setKm] = useState('0');
  const [localError, setLocalError] = useState<string | null>(null);

  const list = useResource<Paginated<Vehicle>>(
    (signal) => api.get('/vehicles', { page, perPage: 20 }, signal),
    [page],
  );
  const save = useAction();
  const remove = useAction();
  const updateKm = useAction();

  const openCreate = () => {
    setPlate('');
    setModel('');
    setCapacity('15');
    setStatus('IDLE');
    setLocalError(null);
    save.reset();
    setCreating(true);
  };

  const openEdit = (vehicle: Vehicle) => {
    setPlate(vehicle.plate);
    setModel(vehicle.model);
    setCapacity(String(vehicle.capacity));
    setStatus(vehicle.status);
    setLocalError(null);
    save.reset();
    setEditing(vehicle);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const err = plateError(plate);
    setLocalError(err);
    if (err) return;

    const payload = {
      plate: plate.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      model: model.trim(),
      capacity: Number(capacity),
      status,
    };

    const done = await save.run(async () => {
      if (editing) await api.patch<Vehicle>(`/vehicles/${editing.id}`, payload);
      else await api.post<Vehicle>('/vehicles', payload);
      return true;
    });

    if (done) {
      setCreating(false);
      setEditing(null);
      list.reload();
    }
  };

  const onKm = async (event: FormEvent) => {
    event.preventDefault();
    if (!odometro) return;
    const done = await updateKm.run(async () => {
      await api.patch<Vehicle>(`/vehicles/${odometro.id}/km`, { km: Number(km) });
      return true;
    });
    if (done) {
      setOdometro(null);
      list.reload();
    }
  };

  const onDelete = async () => {
    if (!removing) return;
    const done = await remove.run(async () => {
      await api.del(`/vehicles/${removing.id}`);
      return true;
    });
    if (done) {
      setRemoving(null);
      list.reload();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={openCreate}>Cadastrar veículo</Button>
      </div>

      {list.loading ? <SkeletonList rows={3} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<Bus size={30} />}
          title="Nenhum veículo na frota"
          description="Sem veículo não há ponto, escala de fretamento nem rateio de despesa por van. Cadastre o primeiro."
          action={<Button onClick={openCreate}>Cadastrar veículo</Button>}
        />
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((v) => (
              <li key={v.id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink-50">
                      {v.plate} · {v.model || 'sem modelo'}
                    </p>
                    <p className="text-xs text-ink-400">
                      {v.capacity} lugares · {v.km.toLocaleString('pt-BR')} km
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={v.status === 'MAINTENANCE' ? 'warn' : v.status === 'ON_ROUTE' ? 'good' : 'neutral'}>
                      {label.vehicleStatus(v.status)}
                    </Badge>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setKm(String(v.km));
                        updateKm.reset();
                        setOdometro(v);
                      }}
                    >
                      Odômetro
                    </Button>
                    <Button variant="secondary" onClick={() => openEdit(v)}>
                      Editar
                    </Button>
                    <Button variant="danger" onClick={() => setRemoving(v)}>
                      Remover
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
        title={editing ? 'Editar veículo' : 'Cadastrar veículo'}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      >
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <InlineError message={save.error} />
          <TextInput
            label="Placa"
            name="plate"
            required
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            error={localError ?? save.fieldErrors.plate}
            hint="Mercosul (ABC1D23) ou antiga (ABC1234)."
          />
          <TextInput
            label="Modelo"
            name="model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            error={save.fieldErrors.model}
          />
          <TextInput
            label="Capacidade (lugares)"
            name="capacity"
            type="number"
            min={1}
            max={120}
            required
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            error={save.fieldErrors.capacity}
          />
          <SelectInput
            label="Situação"
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as VehicleStatus)}
            error={save.fieldErrors.status}
          >
            <option value="IDLE">Disponível</option>
            <option value="ON_ROUTE">Em rota</option>
            <option value="MAINTENANCE">Manutenção</option>
          </SelectInput>
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

      <Modal open={odometro !== null} title="Atualizar odômetro" onClose={() => setOdometro(null)}>
        <form className="flex flex-col gap-4" onSubmit={onKm} noValidate>
          <InlineError message={updateKm.error} />
          <TextInput
            label="Quilometragem"
            name="km"
            type="number"
            min={0}
            required
            value={km}
            onChange={(e) => setKm(e.target.value)}
            error={updateKm.fieldErrors.km}
            hint="O odômetro só avança. Valor menor que o registrado é recusado pelo servidor."
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setOdometro(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={updateKm.pending}>
              Registrar
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title="Remover veículo"
        message={
          removing
            ? `Remover o veículo ${removing.plate}? A exclusão é lógica. Fretamento pendente ou ponto em aberto bloqueiam a operação.`
            : ''
        }
        confirmLabel="Remover"
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

function Motoristas() {
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [archiving, setArchiving] = useState<Driver | null>(null);

  const [name, setName] = useState('');
  const [shiftType, setShiftType] = useState<Shift>('MORNING');
  const [dailyRate, setDailyRate] = useState('');

  const list = useResource<Paginated<Driver>>(
    (signal) => api.get('/drivers', { page, perPage: 20 }, signal),
    [page],
  );
  const save = useAction();
  const archive = useAction();

  const openCreate = () => {
    setName('');
    setShiftType('MORNING');
    setDailyRate('');
    save.reset();
    setCreating(true);
  };

  const openEdit = (driver: Driver) => {
    setName(driver.name);
    setShiftType(driver.shiftType);
    setDailyRate((driver.dailyRate.cents / 100).toFixed(2).replace('.', ','));
    save.reset();
    setEditing(driver);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const cents = parseBrlToCents(dailyRate);
    if (cents === null) return;
    const payload = { name: name.trim(), shiftType, dailyRate: cents / 100 };

    const done = await save.run(async () => {
      if (editing) await api.patch<Driver>(`/drivers/${editing.id}`, payload);
      else await api.post<Driver>('/drivers', payload);
      return true;
    });

    if (done) {
      setCreating(false);
      setEditing(null);
      list.reload();
    }
  };

  const onArchive = async () => {
    if (!archiving) return;
    const done = await archive.run(async () => {
      await api.post(`/drivers/${archiving.id}/archive`);
      return true;
    });
    if (done) {
      setArchiving(null);
      list.reload();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={openCreate}>Cadastrar motorista</Button>
      </div>

      {list.loading ? <SkeletonList rows={3} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<User size={30} />}
          title="Nenhum motorista cadastrado"
          description="O cadastro do motorista é a base da diária e do ponto. Ele nunca é apagado — no desligamento vira somente leitura."
          action={<Button onClick={openCreate}>Cadastrar motorista</Button>}
        />
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((d) => (
              <li key={d.id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink-50">{d.name}</p>
                    <p className="text-xs text-ink-400">
                      {label.shift(d.shiftType)} · diária {d.dailyRate.formatted}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={d.status === 'ACTIVE' ? 'good' : 'neutral'}>
                      {label.membershipStatus(d.status)}
                    </Badge>
                    <Button variant="secondary" onClick={() => openEdit(d)}>
                      Editar
                    </Button>
                    {d.status === 'ACTIVE' ? (
                      <Button variant="danger" onClick={() => setArchiving(d)}>
                        Arquivar
                      </Button>
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

      <Modal
        open={creating || editing !== null}
        title={editing ? 'Editar motorista' : 'Cadastrar motorista'}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      >
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <InlineError message={save.error} />
          <TextInput
            label="Nome"
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={save.fieldErrors.name}
          />
          <SelectInput
            label="Turno"
            name="shiftType"
            value={shiftType}
            onChange={(e) => setShiftType(e.target.value as Shift)}
            error={save.fieldErrors.shiftType}
          >
            <option value="MORNING">Manhã</option>
            <option value="AFTERNOON">Tarde</option>
            <option value="FULL">Integral</option>
          </SelectInput>
          <TextInput
            label="Diária (R$)"
            name="dailyRate"
            inputMode="decimal"
            required
            value={dailyRate}
            onChange={(e) => setDailyRate(e.target.value)}
            error={save.fieldErrors.dailyRate}
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

      <ConfirmDialog
        open={archiving !== null}
        title="Arquivar motorista"
        message={
          archiving
            ? `Arquivar ${archiving.name}? O cadastro vira somente leitura, o vínculo com a empresa é encerrado e o acesso dele deixa de escrever. Ponto em aberto bloqueia a operação.`
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

export function Fleet() {
  const { hasPermission } = useAuth();
  const podeVeiculos = hasPermission('canManageRoutes');
  const podeMotoristas = hasPermission('canManageHR');
  const [aba, setAba] = useState<'veiculos' | 'motoristas'>(podeVeiculos ? 'veiculos' : 'motoristas');

  if (!podeVeiculos && !podeMotoristas) {
    return (
      <div>
        <PageHeader title="Frota" />
        <PermissionNotice area="Frota" />
      </div>
    );
  }

  const abas = [
    ...(podeVeiculos ? [{ id: 'veiculos' as const, texto: 'Veículos' }] : []),
    ...(podeMotoristas ? [{ id: 'motoristas' as const, texto: 'Motoristas' }] : []),
  ];

  return (
    <div>
      <PageHeader title="Frota" description="Veículos, odômetro e cadastro dos motoristas." />

      <div role="tablist" aria-label="Áreas da frota" className="mb-4 flex flex-wrap gap-2">
        {abas.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={aba === item.id}
            onClick={() => setAba(item.id)}
            className={`min-h-[44px] rounded-lg px-4 text-sm ${
              aba === item.id ? 'bg-brand-500 font-semibold text-ink-950' : 'bg-ink-800 text-ink-200'
            }`}
          >
            {item.texto}
          </button>
        ))}
      </div>

      {aba === 'veiculos' ? <Veiculos /> : <Motoristas />}
    </div>
  );
}
