import { useEffect, useMemo, useState } from 'react';
import { Clock, LogIn, LogOut, MapPin, Pause, Play } from 'lucide-react';

import { api } from '../../lib/api';
import { formatDate, formatTime, label } from '../../lib/format';
import { useAction, useResource } from '../../hooks/useResource';
import {
  Badge,
  Button,
  Card,
  Callout,
  ErrorState,
  InlineError,
  PageHeader,
  SectionTitle,
  SelectInput,
  SkeletonList,
  TextInput,
} from '../../components/ui';
import type { Paginated, Punch, PunchType, Timecard, Vehicle } from '../../lib/types';

/**
 * Ponto do motorista.
 *
 * Ele usa isto de pé, às 6h, com a van ligada e uma mão só. Então:
 * - existe UMA ação óbvia por vez, em botão de 56 px de altura;
 * - o estado atual é a maior coisa da tela, legível de relance;
 * - nada de UUID: a van aparece pela placa, que é o que ele reconhece;
 * - a quilometragem fica atrás de um toque, porque é opcional e ele quase
 *   sempre só quer bater e sair andando.
 */

type Estado = 'FORA' | 'TRABALHANDO' | 'EM_PAUSA';

/**
 * A máquina de estados do servidor, espelhada no botão.
 *
 * Pausa aberta = mais inícios que fins, exatamente como o backend calcula. Sem
 * esse espelho o app ofereceria "iniciar pausa" durante uma pausa e o motorista
 * levaria 409 na cara sem entender por quê.
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

interface Acao {
  type: PunchType;
  texto: string;
  variante: 'primary' | 'secondary' | 'danger';
  Icone: typeof LogIn;
}

/** A primeira ação de cada estado é a principal; as demais ficam abaixo. */
const ACOES: Record<Estado, Acao[]> = {
  FORA: [{ type: 'CLOCK_IN', texto: 'Bater entrada', variante: 'primary', Icone: LogIn }],
  TRABALHANDO: [
    { type: 'BREAK_START', texto: 'Iniciar pausa', variante: 'secondary', Icone: Pause },
    { type: 'CLOCK_OUT', texto: 'Bater saída', variante: 'danger', Icone: LogOut },
  ],
  EM_PAUSA: [{ type: 'BREAK_END', texto: 'Voltar da pausa', variante: 'primary', Icone: Play }],
};

const ESTADO_TEXTO: Record<Estado, string> = {
  FORA: 'Fora do turno',
  TRABALHANDO: 'Em turno',
  EM_PAUSA: 'Em pausa',
};

/** "2h14" — sem segundos, porque ninguém confere ponto no segundo. */
function duracao(desdeIso: string, agora: number): string {
  const minutos = Math.max(0, Math.floor((agora - new Date(desdeIso).getTime()) / 60000));
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return `${horas}h${String(resto).padStart(2, '0')}`;
}

/**
 * Coordenadas da batida, quando o aparelho der — e só quando der.
 *
 * A API aceita `latitude`/`longitude` opcionais e isso é o que permite provar
 * onde a jornada começou. Mas o ponto NUNCA espera pelo GPS: se o sinal
 * demorar, a batida vai sem coordenada. Prender o registro trabalhista de
 * alguém a um satélite seria trocar um dado auxiliar por um dado essencial.
 */
function obterPosicao(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let respondido = false;
    const fechar = (valor: { latitude: number; longitude: number } | null) => {
      if (respondido) return;
      respondido = true;
      resolve(valor);
    };
    const timer = setTimeout(() => fechar(null), 4000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        fechar({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        fechar(null);
      },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 },
    );
  });
}

export function Timeclock() {
  const [vehicleId, setVehicleId] = useState('');
  const [km, setKm] = useState('');
  const [mostrarKm, setMostrarKm] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());

  const cartoes = useResource<Paginated<Timecard>>(
    (signal) => api.get('/timecards', { perPage: 10 }, signal),
    [],
  );
  /*
   * O turno aberto e PERGUNTADO ao servidor, e nao procurado dentro da pagina
   * de cartoes recentes.
   *
   * A versao anterior fazia `items.find(t => t.status === 'IN_PROGRESS')` sobre
   * os 10 ultimos. Um turno que ficou aberto de ontem (motorista que esqueceu
   * de bater a saida — o caso mais comum de todos) cai para fora dessa janela
   * assim que existem 10 cartoes mais novos. A tela entao dizia "Fora do
   * turno", liberava o botao "Bater entrada", e o servidor respondia 409: a
   * interface mandava a pessoa fazer exatamente o que ia falhar.
   */
  const turnoAberto = useResource<Paginated<Timecard>>(
    (signal) => api.get('/timecards', { status: 'IN_PROGRESS', perPage: 1 }, signal),
    [],
  );
  const veiculos = useResource<Paginated<Vehicle>>(
    (signal) => api.get('/vehicles', { perPage: 100 }, signal),
    [],
  );
  const punch = useAction();

  const aberto = turnoAberto.data?.items[0];
  const estado = estadoDe(aberto);
  const veiculoAtual = aberto?.vehicleId ?? vehicleId;

  // O contador só existe enquanto há turno aberto: relógio girando numa tela
  // parada é bateria gasta à toa.
  useEffect(() => {
    if (!aberto) return;
    const id = setInterval(() => setAgora(Date.now()), 30000);
    return () => clearInterval(id);
  }, [aberto]);

  const placaPor = useMemo(
    () => new Map((veiculos.data?.items ?? []).map((v) => [v.id, v.plate])),
    [veiculos.data],
  );

  const entrada = aberto?.punches.find((p) => p.type === 'CLOCK_IN');
  const ultimaPausa = aberto ? [...aberto.punches].reverse().find((p) => p.type === 'BREAK_START') : undefined;

  const onPunch = async (type: PunchType) => {
    const precisaKm = type === 'CLOCK_IN' || type === 'CLOCK_OUT';
    const posicao = await obterPosicao();
    const body: Record<string, unknown> = { type, vehicleId: veiculoAtual };
    if (precisaKm && km.trim()) body.km = Number(km);
    if (posicao) Object.assign(body, posicao);

    const done = await punch.run(async () => {
      await api.post('/timecards/punch', body);
      return true;
    });
    if (done) {
      setKm('');
      setMostrarKm(false);
      cartoes.reload();
      turnoAberto.reload();
    }
  };

  const acoes = ACOES[estado];
  const bloqueado = estado === 'FORA' && !vehicleId;

  return (
    <div>
      <PageHeader
        title="Ponto"
        description="Cada batida é um fato registrado, nunca uma correção. A jornada é reconstruída pela sequência."
      />

      {cartoes.loading ? <SkeletonList rows={2} /> : null}
      {cartoes.error ? <ErrorState message={cartoes.error} onRetry={cartoes.reload} /> : null}

      {cartoes.data ? (
        <div className="flex flex-col gap-4">
          {/* O estado atual: a maior coisa da tela. */}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-400">Situação agora</p>
                <p
                  className="mt-1 text-[2rem] font-semibold leading-tight text-ink-50"
                  data-testid="estado-ponto"
                >
                  {ESTADO_TEXTO[estado]}
                </p>
                {estado === 'TRABALHANDO' && entrada ? (
                  <p className="tnum mt-1 text-sm text-ink-400">
                    Trabalhando há {duracao(entrada.createdAt, agora)} · entrou às{' '}
                    {formatTime(entrada.createdAt)}
                  </p>
                ) : null}
                {estado === 'EM_PAUSA' && ultimaPausa ? (
                  <p className="tnum mt-1 text-sm text-warn-400">
                    Em pausa há {duracao(ultimaPausa.createdAt, agora)} · desde{' '}
                    {formatTime(ultimaPausa.createdAt)}
                  </p>
                ) : null}
                {estado === 'FORA' ? (
                  <p className="mt-1 text-sm text-ink-400">
                    Escolha a van e bata a entrada para começar a jornada.
                  </p>
                ) : null}
              </div>

              <Badge
                tone={estado === 'TRABALHANDO' ? 'good' : estado === 'EM_PAUSA' ? 'warn' : 'neutral'}
              >
                <Clock aria-hidden="true" size={12} />
                {aberto
                  ? `Van ${placaPor.get(aberto.vehicleId) ?? '—'}`
                  : 'Nenhum cartão aberto'}
              </Badge>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <InlineError message={punch.error} />

              {estado === 'FORA' ? (
                veiculos.error ? (
                  <ErrorState message={veiculos.error} onRetry={veiculos.reload} />
                ) : veiculos.data && veiculos.data.items.length === 0 ? (
                  <Callout title="Nenhuma van cadastrada nesta frota">
                    O ponto é sempre batido em um veículo. Peça à gestão para cadastrar a van em
                    Frota — sem isso a entrada não pode ser registrada.
                  </Callout>
                ) : (
                  <SelectInput
                    label="Em qual van você vai hoje?"
                    name="vehicleId"
                    required
                    value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}
                  >
                    <option value="">Selecione a van</option>
                    {(veiculos.data?.items ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate}
                        {v.model ? ` — ${v.model}` : ''}
                      </option>
                    ))}
                  </SelectInput>
                )
              ) : null}

              {estado !== 'EM_PAUSA' ? (
                mostrarKm ? (
                  <TextInput
                    label="Quilometragem do painel"
                    name="km"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={km}
                    autoFocus
                    onChange={(e) => setKm(e.target.value)}
                    hint="Só é aceita na entrada e na saída, e a saída não pode ser menor que a entrada."
                  />
                ) : (
                  <Button variant="ghost" onClick={() => setMostrarKm(true)}>
                    Anotar a quilometragem (opcional)
                  </Button>
                )
              ) : null}

              {/* Ação principal em corpo grande; as secundárias abaixo dela. */}
              <div className="flex flex-col gap-2">
                {acoes.map((acao, indice) => (
                  <Button
                    key={acao.type}
                    variant={acao.variante}
                    size={indice === 0 ? 'lg' : 'md'}
                    block
                    loading={punch.pending}
                    disabled={bloqueado}
                    onClick={() => void onPunch(acao.type)}
                  >
                    <acao.Icone aria-hidden="true" size={indice === 0 ? 22 : 18} />
                    {acao.texto}
                  </Button>
                ))}
              </div>

              {bloqueado && veiculos.data && veiculos.data.items.length > 0 ? (
                <p className="text-center text-xs text-ink-400">
                  Escolha a van acima para liberar a batida.
                </p>
              ) : (
                <p className="flex items-center justify-center gap-1.5 text-center text-xs text-ink-400">
                  <MapPin aria-hidden="true" size={13} />
                  Se o aparelho permitir, a localização acompanha a batida. A batida nunca espera
                  pelo GPS.
                </p>
              )}
            </div>
          </Card>

          {aberto ? (
            <Card>
              <SectionTitle hint="Sequência do cartão aberto, na ordem em que aconteceu.">
                Batidas de hoje
              </SectionTitle>
              <ol className="flex flex-col gap-2">
                {aberto.punches.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-ink-800 px-3 py-2.5 text-sm"
                  >
                    <span className="font-medium text-ink-50">{label.punch(p.type)}</span>
                    <span className="tnum text-ink-400">
                      {formatTime(p.createdAt)}
                      {p.km !== null ? ` · ${p.km.toLocaleString('pt-BR')} km` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}

          <Card>
            <SectionTitle>Jornadas anteriores</SectionTitle>
            {cartoes.data.items.filter((t) => t.status === 'COMPLETED').length === 0 ? (
              <p className="rounded-xl border border-dashed border-ink-700 px-4 py-6 text-center text-sm text-ink-400">
                Nenhuma jornada encerrada ainda. Assim que você bater a saída, o cartão do dia
                aparece aqui com todas as batidas.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {cartoes.data.items
                  .filter((t) => t.status === 'COMPLETED')
                  .map((t) => (
                    <li key={t.id} className="rounded-xl bg-ink-800 px-3 py-2.5">
                      <p className="text-sm font-medium text-ink-50">
                        {formatDate(t.date)}
                        <span className="ml-2 text-xs font-normal text-ink-400">
                          Van {placaPor.get(t.vehicleId) ?? '—'}
                        </span>
                      </p>
                      <p className="tnum mt-0.5 text-xs text-ink-400">
                        {t.punches
                          .map((p) => `${label.punch(p.type)} ${formatTime(p.createdAt)}`)
                          .join(' · ')}
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
