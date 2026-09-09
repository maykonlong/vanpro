import { useState } from 'react';
import { Users } from 'lucide-react';

import { api } from '../../lib/api';
import { formatDateTime, label } from '../../lib/format';
import { useAction, useResource } from '../../hooks/useResource';
import { photoSrc } from '../../components/PhotoUpload';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  InlineError,
  PageHeader,
  Pagination,
  SelectInput,
  SkeletonList,
} from '../../components/ui';
import type { Charter, Paginated, Student, StudentStatus } from '../../lib/types';

const PROXIMO: Record<StudentStatus, { status: StudentStatus; texto: string }[]> = {
  PENDING: [
    { status: 'BOARDED', texto: 'Embarcou' },
    { status: 'ABSENT', texto: 'Faltou' },
  ],
  BOARDED: [{ status: 'DELIVERED', texto: 'Entregue' }],
  DELIVERED: [{ status: 'PENDING', texto: 'Reabrir' }],
  ABSENT: [{ status: 'PENDING', texto: 'Reabrir' }],
};

/**
 * Lista de embarque compartilhada por motorista e monitor.
 * O check-in e a mesma rota (`PATCH /students/:id/checkin`) para os dois papeis.
 */
export function BoardingList({ titulo, descricao }: { titulo: string; descricao: string }) {
  const [page, setPage] = useState(1);
  const [shift, setShift] = useState('');

  const list = useResource<Paginated<Student>>(
    (signal) => api.get('/students', { page, perPage: 30, shift }, signal),
    [page, shift],
  );
  const checkin = useAction();

  const onCheckin = async (student: Student, status: StudentStatus) => {
    const done = await checkin.run(async () => {
      await api.patch<Student>(`/students/${student.id}/checkin`, { status });
      return true;
    });
    if (done) list.reload();
  };

  return (
    <div>
      <PageHeader title={titulo} description={descricao} />

      <Card className="mb-4">
        <div className="w-56">
          <SelectInput
            label="Turno"
            name="shift"
            value={shift}
            onChange={(e) => {
              setShift(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="MORNING">Manhã</option>
            <option value="AFTERNOON">Tarde</option>
            <option value="FULL">Integral</option>
          </SelectInput>
        </div>
      </Card>

      <InlineError message={checkin.error} />

      {list.loading ? <SkeletonList rows={5} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<Users size={30} />}
          title="Nenhum aluno na lista"
          description="Quando a gestão cadastrar alunos neste turno, eles aparecem aqui para o check-in de embarque e entrega."
        />
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((s) => (
              <li key={s.id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    {photoSrc(s.photoUrl) ? (
                      <img
                        src={photoSrc(s.photoUrl) ?? ''}
                        alt={`Foto de ${s.name}`}
                        className="h-12 w-12 rounded-full border border-ink-700 object-cover"
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-800 text-sm text-ink-400"
                      >
                        {s.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-ink-50">{s.name}</p>
                      <p className="text-xs text-ink-400">
                        {s.school} · {label.shift(s.shift)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        s.status === 'DELIVERED'
                          ? 'good'
                          : s.status === 'ABSENT'
                            ? 'bad'
                            : s.status === 'BOARDED'
                              ? 'warn'
                              : 'neutral'
                      }
                    >
                      {label.studentStatus(s.status)}
                    </Badge>
                    {PROXIMO[s.status].map((acao) => (
                      <Button
                        key={acao.status}
                        variant={acao.status === 'ABSENT' ? 'danger' : 'secondary'}
                        loading={checkin.pending}
                        onClick={() => void onCheckin(s, acao.status)}
                      >
                        {acao.texto}
                      </Button>
                    ))}
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
    </div>
  );
}

export function DriverRoute() {
  const fretamentos = useResource<Paginated<Charter>>(
    (signal) => api.get('/charters', { perPage: 10, status: 'PENDING' }, signal),
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <BoardingList
        titulo="Rota do dia"
        descricao="Check-in de embarque e entrega dos alunos. Cada alteração vai para a trilha de auditoria."
      />

      <Card>
        <h2 className="mb-3 text-base font-semibold text-ink-50">Fretamentos atribuídos a você</h2>
        {fretamentos.loading ? <SkeletonList rows={2} /> : null}
        {fretamentos.error ? (
          <ErrorState message={fretamentos.error} onRetry={fretamentos.reload} />
        ) : null}
        {fretamentos.data && fretamentos.data.items.length === 0 ? (
          <p className="text-sm text-ink-400">
            Nenhum fretamento agendado para você. A lista mostra apenas os contratos em que você foi
            escalado.
          </p>
        ) : null}
        {fretamentos.data && fretamentos.data.items.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {fretamentos.data.items.map((c) => (
              <li key={c.id} className="rounded-lg bg-ink-800 px-3 py-2">
                <p className="text-sm text-ink-50">{c.title}</p>
                <p className="text-xs text-ink-400">
                  {formatDateTime(c.startDate)} até {formatDateTime(c.endDate)}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
