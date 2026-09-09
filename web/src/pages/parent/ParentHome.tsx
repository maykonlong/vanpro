import { Bus, MapPin } from 'lucide-react';

import { api } from '../../lib/api';
import { formatDateTime, label } from '../../lib/format';
import { useResource } from '../../hooks/useResource';
import { useRealtime } from '../../hooks/useRealtime';
import { photoSrc } from '../../components/PhotoUpload';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonList,
} from '../../components/ui';
import type { Paginated, Student } from '../../lib/types';

/**
 * Acompanhamento do responsavel.
 *
 * A posicao chega por socket na sala da propria empresa; nao ha historico de
 * trajeto guardado, so o ponto atual enquanto a van esta em rota.
 */
export function ParentHome() {
  const filhos = useResource<Paginated<Student>>(
    (signal) => api.get('/students', { perPage: 20 }, signal),
    [],
  );
  // A API nao expoe a frota ao responsavel (`/vehicles` e restrito a operacao).
  // Assinamos apenas o que ele pode acompanhar; sem id de veiculo, o que chega
  // e o canal de avisos da empresa — e a tela diz isso em vez de exibir um mapa
  // que nunca recebe ponto.
  const { positions, connected, incidents } = useRealtime([]);
  const posicoes = Object.values(positions);

  return (
    <div>
      <PageHeader
        title="Acompanhamento"
        description="Situação dos seus filhos na rota e posição das vans em circulação."
      />

      <div className="flex flex-col gap-4">
        {incidents.length > 0 ? (
          <Card>
            <h2 className="text-base font-semibold text-bad-400">Avisos da empresa</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {incidents.map((i) => (
                <li key={i.id} className="rounded-lg bg-ink-800 px-3 py-2">
                  <p className="text-sm text-ink-50">{i.title}</p>
                  <p className="text-xs text-ink-400">{i.description}</p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {filhos.loading ? <SkeletonList rows={3} /> : null}
        {filhos.error ? <ErrorState message={filhos.error} onRetry={filhos.reload} /> : null}

        {filhos.data && filhos.data.items.length === 0 ? (
          <EmptyState
            icon={<Bus size={30} />}
            title="Nenhum aluno vinculado ao seu acesso"
            description="Peça a empresa de transporte para vincular o cadastro do seu filho ao seu usuário. Sem esse vínculo não há o que acompanhar."
          />
        ) : null}

        {filhos.data && filhos.data.items.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {filhos.data.items.map((s) => (
              <li key={s.id}>
                <Card className="flex items-center gap-3">
                  {photoSrc(s.photoUrl) ? (
                    <img
                      src={photoSrc(s.photoUrl) ?? ''}
                      alt={`Foto de ${s.name}`}
                      className="h-14 w-14 rounded-full border border-ink-700 object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-800 text-sm text-ink-400"
                    >
                      {s.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-semibold text-ink-50">{s.name}</p>
                    <p className="text-xs text-ink-400">
                      {s.school} · {label.shift(s.shift)}
                    </p>
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
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ) : null}

        <Card>
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink-50">
            <MapPin aria-hidden="true" size={18} /> Vans em rota
          </h2>
          <p className="mt-1 text-xs text-ink-400" aria-live="polite">
            {connected ? 'Conectado — a posição chega em tempo real.' : 'Tempo real desconectado.'}
          </p>

          {posicoes.length === 0 ? (
            <p className="mt-3 text-sm text-ink-400">
              Nenhuma posição disponível. O acompanhamento no mapa depende de a empresa liberar o
              veículo do seu filho para o seu acesso — hoje a lista de vans não é exposta ao
              responsável, então não há o que exibir. Preferimos dizer isso a mostrar um mapa
              parado sugerindo que a van não saiu.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {posicoes.map((pos) => (
                <li key={pos.vehicleId} className="rounded-lg bg-ink-800 px-3 py-2">
                  <p className="text-sm text-ink-50">Van {pos.vehicleId.slice(0, 8)}</p>
                  <p className="text-xs text-ink-400">
                    {pos.latitude.toFixed(5)}, {pos.longitude.toFixed(5)} · {formatDateTime(pos.at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
