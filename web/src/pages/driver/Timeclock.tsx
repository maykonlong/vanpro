import { useState } from 'react';
import { Clock } from 'lucide-react';

import { api } from '../../lib/api';
import { formatDateTime, formatTime, label } from '../../lib/format';
import { useAction, useResource } from '../../hooks/useResource';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  InlineError,
  PageHeader,
  SelectInput,
  SkeletonList,
  TextInput,
} from '../../components/ui';
import type { Paginated, Punch, PunchType, Timecard, Vehicle } from '../../lib/types';

type Estado = 'FORA' | 'TRABALHANDO' | 'EM_PAUSA';

/**
 * A maquina de estados do servidor, refletida no botao.
 *
 * Pausa aberta = mais inicios que fins, exatamente como o backend calcula. Sem
 * esse espelho o app ofereceria "iniciar pausa" durante uma pausa e o motorista
 * levaria 409 na cara sem entender por que.
 */
function pausaAberta(punches: Punch[]): boolean {
  const inicios = punches.filter((p) => p.type === 'BREAK_START').length;
  const fins = punches.filter((p) => p.type === 'BREAK_END').length;
  return inicios > fins;
}

function estadoDe(aberto: Timecard | undefined): Estado {
  if (!aberto) return 'FORA';
  return pausaAberta(aberto.punches) ? 'EM_PAUSA' : 'TRABALHANDO';
}

const ACOES: Record<Estado, Array<{ type: PunchType; texto: string; variante: 'primary' | 'secondary' | 'danger' }>> = {
  FORA: [{ type: 'CLOCK_IN', texto: 'Registrar entrada', variante: 'primary' }],
  TRABALHANDO: [
    { type: 'BREAK_START', texto: 'Iniciar pausa', variante: 'secondary' },
    { type: 'CLOCK_OUT', texto: 'Registrar saída', variante: 'danger' },
  ],
  EM_PAUSA: [{ type: 'BREAK_END', texto: 'Encerrar pausa', variante: 'primary' }],
};

export function Timeclock() {
  const [vehicleId, setVehicleId] = useState('');
  const [km, setKm] = useState('');

  const cartoes = useResource<Paginated<Timecard>>(
    (signal) => api.get('/timecards', { perPage: 10 }, signal),
    [],
  );
  const veiculos = useResource<Paginated<Vehicle>>(
    (signal) => api.get('/vehicles', { perPage: 100 }, signal),
    [],
  );
  const punch = useAction();

  const aberto = cartoes.data?.items.find((t) => t.status === 'IN_PROGRESS');
  const estado = estadoDe(aberto);
  const veiculoAtual = aberto?.vehicleId ?? vehicleId;

  const onPunch = async (type: PunchType) => {
    const precisaKm = type === 'CLOCK_IN' || type === 'CLOCK_OUT';
    const body: Record<string, unknown> = { type, vehicleId: veiculoAtual };
    if (precisaKm && km.trim()) body.km = Number(km);

    const done = await punch.run(async () => {
      await api.post('/timecards/punch', body);
      return true;
    });
    if (done) {
      setKm('');
      cartoes.reload();
    }
  };

  return (
    <div>
      <PageHeader
        title="Bater ponto"
        description="Cada batida é um fato registrado, nunca uma correção. A jornada é reconstruída pela sequência."
      />

      {cartoes.loading ? <SkeletonList rows={2} /> : null}
      {cartoes.error ? <ErrorState message={cartoes.error} onRetry={cartoes.reload} /> : null}

      {cartoes.data ? (
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-400">Situação atual</p>
                <p className="mt-1 text-xl font-semibold text-ink-50" data-testid="estado-ponto">
                  {estado === 'FORA'
                    ? 'Fora do turno'
                    : estado === 'EM_PAUSA'
                      ? 'Em pausa'
                      : 'Em turno'}
                </p>
              </div>
              <Badge tone={estado === 'TRABALHANDO' ? 'good' : estado === 'EM_PAUSA' ? 'warn' : 'neutral'}>
                {estado === 'FORA' ? 'Sem cartão aberto' : `Cartão ${aberto?.id.slice(0, 8)}`}
              </Badge>
            </div>

            <InlineError message={punch.error} />

            {estado === 'FORA' ? (
              <div className="mt-4">
                <SelectInput
                  label="Veículo"
                  name="vehicleId"
                  required
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                >
                  <option value="">Selecione a van</option>
                  {(veiculos.data?.items ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate} — {v.model}
                    </option>
                  ))}
                </SelectInput>
              </div>
            ) : (
              <p className="mt-4 text-sm text-ink-400">
                Turno em andamento no veículo {aberto?.vehicleId.slice(0, 8)}. Trocar de van exige
                encerrar o turno.
              </p>
            )}

            {estado !== 'EM_PAUSA' ? (
              <div className="mt-4">
                <TextInput
                  label="Quilometragem (opcional)"
                  name="km"
                  type="number"
                  min={0}
                  value={km}
                  onChange={(e) => setKm(e.target.value)}
                  hint="Só aceita na entrada e na saída, e a saída não pode ser menor que a entrada."
                />
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {ACOES[estado].map((acao) => (
                <Button
                  key={acao.type}
                  variant={acao.variante}
                  loading={punch.pending}
                  disabled={estado === 'FORA' && !vehicleId}
                  onClick={() => void onPunch(acao.type)}
                >
                  {acao.texto}
                </Button>
              ))}
            </div>
          </Card>

          {aberto ? (
            <Card>
              <h2 className="mb-3 text-base font-semibold text-ink-50">Batidas de hoje</h2>
              <ul className="flex flex-col gap-2">
                {aberto.punches.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3 rounded-lg bg-ink-800 px-3 py-2 text-sm">
                    <span className="text-ink-50">{label.punch(p.type)}</span>
                    <span className="text-ink-400">
                      {formatTime(p.createdAt)}
                      {p.km !== null ? ` · ${p.km} km` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <h2 className="mb-3 text-base font-semibold text-ink-50">Cartões anteriores</h2>
            {cartoes.data.items.filter((t) => t.status === 'COMPLETED').length === 0 ? (
              <EmptyState
                icon={<Clock size={28} />}
                title="Nenhuma jornada encerrada"
                description="Assim que você registrar a saída, o cartão do dia aparece aqui com todas as batidas."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {cartoes.data.items
                  .filter((t) => t.status === 'COMPLETED')
                  .map((t) => (
                    <li key={t.id} className="rounded-lg bg-ink-800 px-3 py-2">
                      <p className="text-sm text-ink-50">{formatDateTime(t.date)}</p>
                      <p className="text-xs text-ink-400">
                        {t.punches.map((p) => `${label.punch(p.type)} ${formatTime(p.createdAt)}`).join(' · ')}
                      </p>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
