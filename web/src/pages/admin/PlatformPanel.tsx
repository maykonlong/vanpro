import { Server } from 'lucide-react';

import { api } from '../../lib/api';
import { useResource } from '../../hooks/useResource';
import { useAuth } from '../../context/AuthContext';
import { Badge, Card, ErrorState, PageHeader, SkeletonList } from '../../components/ui';
import type { FeatureFlags } from '../../lib/types';

interface Readiness {
  status: string;
  checks: Record<string, 'ok' | 'down'>;
}

/**
 * Painel da plataforma.
 *
 * Mostra apenas o que a API realmente expoe hoje: as integracoes ligadas e as
 * sondas de saude. NAO existe endpoint que liste empresas ou metricas entre
 * tenants — e inventar um numero aqui seria pior que a ausencia dele, porque
 * pareceria medicao. Enquanto a rota nao existir, o painel diz "nao medido".
 */
export function PlatformPanel() {
  const { user } = useAuth();

  const flags = useResource<FeatureFlags>((signal) => api.get('/health/features', undefined, signal), []);
  const ready = useResource<Readiness>((signal) => api.get('/health/ready', undefined, signal), []);

  return (
    <div>
      <PageHeader
        title="Plataforma"
        description={`Sessão de ${user?.name ?? ''} com papel de administrador da plataforma.`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink-50">
            <Server aria-hidden="true" size={18} /> Dependências
          </h2>
          {ready.loading ? <SkeletonList rows={1} /> : null}
          {ready.error ? <ErrorState message={ready.error} onRetry={ready.reload} /> : null}
          {ready.data ? (
            <>
              <p className="mt-2 text-sm text-ink-400">
                Situação geral: <span className="text-ink-50">{ready.data.status}</span>
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {Object.entries(ready.data.checks).map(([nome, estado]) => (
                  <li key={nome}>
                    <Badge tone={estado === 'ok' ? 'good' : 'bad'}>
                      {nome}: {estado === 'ok' ? 'no ar' : 'fora'}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-400">
                Banco fora significa "não pronto"; cache fora significa degradado, não parado — o
                limitador cai para memória local e o produto continua de pé.
              </p>
            </>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-ink-50">Integrações do ambiente</h2>
          {flags.loading ? <SkeletonList rows={1} /> : null}
          {flags.error ? <ErrorState message={flags.error} onRetry={flags.reload} /> : null}
          {flags.data ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  ['Cobrança', flags.data.billing],
                  ['WhatsApp', flags.data.whatsapp],
                  ['Mapas', flags.data.maps],
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

        <Card className="lg:col-span-2">
          <h2 className="text-base font-semibold text-ink-50">Métricas entre empresas</h2>
          <p className="mt-2 text-sm text-ink-400">
            <strong className="text-warn-400">Não medido.</strong> A API não expõe hoje nenhuma rota
            que atravesse empresas — o guard de tenant recusa consulta sem contexto, e não existe um
            endpoint administrativo de plataforma. Números agregados só aparecerão aqui quando essa
            rota existir e for auditada; até lá, esta seção declara a ausência em vez de mostrar
            zeros que pareceriam medição.
          </p>
        </Card>
      </div>
    </div>
  );
}
