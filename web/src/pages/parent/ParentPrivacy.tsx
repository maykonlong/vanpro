import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { api } from '../../lib/api';
import { formatDateTime, label } from '../../lib/format';
import { useAction, useResource } from '../../hooks/useResource';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  InlineError,
  PageHeader,
  SkeletonList,
  SuccessNote,
} from '../../components/ui';
import type { Consent, Paginated } from '../../lib/types';

interface MyData {
  manifesto: { geradoEm: string; baseLegal: string; observacao: string };
  usuario: {
    id: string;
    name: string;
    email: string;
    role: string;
    createdAt: string;
    isTwoFactorEnabled: boolean;
  };
}

/**
 * Central de privacidade do titular.
 *
 * Cada direito do Art. 18 tem um botao que chama uma rota real e auditada.
 * Direito sem endereco e politica de privacidade, nao software.
 */
export function ParentPrivacy() {
  const [baixando, setBaixando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<Consent | null>(null);

  const meus = useResource<MyData>((signal) => api.get('/privacy/my-data', undefined, signal), []);
  const consentimentos = useResource<Paginated<Consent>>(
    (signal) => api.get('/privacy/consents', { perPage: 50 }, signal),
    [],
  );

  const exportar = useAction();
  const consentir = useAction();
  const esquecer = useAction();

  const onExport = async () => {
    setAviso(null);
    setBaixando(true);
    try {
      const blob = await api.blob('/privacy/export', { page: 1, perPage: 50 });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vanpro-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setAviso('Arquivo gerado. Se houver mais páginas, o manifesto dentro do JSON indica quantas.');
    } finally {
      setBaixando(false);
    }
  };

  const onConsent = async (aluno: Consent, campo: 'lgpdConsent' | 'imageConsent', valor: boolean) => {
    const done = await consentir.run(async () => {
      await api.post('/privacy/consents', { studentId: aluno.id, [campo]: valor });
      return true;
    });
    if (done) consentimentos.reload();
  };

  const onForget = async () => {
    if (!excluindo) return;
    const data = await esquecer.run(() =>
      api.post<{ message: string }>('/privacy/forget-me', { studentId: excluindo.id }),
    );
    if (data) {
      setAviso(data.message);
      setExcluindo(null);
      consentimentos.reload();
    }
  };

  return (
    <div>
      <PageHeader
        title="Meus dados (LGPD)"
        description="Confirmação, acesso, portabilidade, consentimento e eliminação — cada um com endereço próprio e registrado em trilha."
      />

      <SuccessNote message={aviso} />

      <div className="mt-4 flex flex-col gap-4">
        <Card>
          <h2 className="text-base font-semibold text-ink-50">Portabilidade (Art. 18, V)</h2>
          <p className="mt-1 text-sm text-ink-400">
            Baixe em JSON estruturado tudo o que a empresa guarda sobre os seus filhos, incluindo o
            histórico de faturas.
          </p>
          <InlineError message={exportar.error} />
          <Button className="mt-3" loading={baixando} onClick={() => void onExport()}>
            Exportar meus dados
          </Button>
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-ink-50">Confirmação e acesso (Art. 18, I e II)</h2>
          {meus.loading ? <SkeletonList rows={1} /> : null}
          {meus.error ? <ErrorState message={meus.error} onRetry={meus.reload} /> : null}
          {meus.data ? (
            <>
              <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-200">
                <li>Nome: {meus.data.usuario.name}</li>
                <li>E-mail: {meus.data.usuario.email}</li>
                <li>Conta criada em: {formatDateTime(meus.data.usuario.createdAt)}</li>
                <li>
                  Verificação em duas etapas:{' '}
                  {meus.data.usuario.isTwoFactorEnabled ? 'ativa' : 'inativa'}
                </li>
              </ul>
              <p className="mt-3 text-xs text-ink-400">{meus.data.manifesto.observacao}</p>
            </>
          ) : null}
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-ink-50">
            Consentimentos e eliminação (Art. 18, IV, VI e IX)
          </h2>
          <InlineError message={consentir.error} />
          <InlineError message={esquecer.error} />

          {consentimentos.loading ? <SkeletonList rows={2} /> : null}
          {consentimentos.error ? (
            <ErrorState message={consentimentos.error} onRetry={consentimentos.reload} />
          ) : null}

          {consentimentos.data && consentimentos.data.items.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck size={28} />}
              title="Nenhum aluno vinculado"
              description="Quando a empresa vincular o cadastro do seu filho ao seu acesso, os consentimentos aparecem aqui para você conceder ou revogar."
            />
          ) : null}

          {consentimentos.data && consentimentos.data.items.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-3">
              {consentimentos.data.items.map((aluno) => (
                <li key={aluno.id} className="rounded-lg bg-ink-800 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-50">{aluno.name}</p>
                      <p className="text-xs text-ink-400">
                        Última manifestação: {formatDateTime(aluno.consentDate)}
                      </p>
                    </div>
                    {aluno.deleteRequestStatus !== 'NONE' ? (
                      <Badge tone="warn">{label.deleteRequest(aluno.deleteRequestStatus)}</Badge>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant={aluno.lgpdConsent ? 'secondary' : 'primary'}
                      loading={consentir.pending}
                      onClick={() => void onConsent(aluno, 'lgpdConsent', !aluno.lgpdConsent)}
                    >
                      {aluno.lgpdConsent ? 'Revogar tratamento de dados' : 'Autorizar tratamento de dados'}
                    </Button>
                    <Button
                      variant={aluno.imageConsent ? 'secondary' : 'primary'}
                      loading={consentir.pending}
                      onClick={() => void onConsent(aluno, 'imageConsent', !aluno.imageConsent)}
                    >
                      {aluno.imageConsent ? 'Revogar uso de imagem' : 'Autorizar uso de imagem'}
                    </Button>
                    <Button variant="danger" onClick={() => setExcluindo(aluno)}>
                      Solicitar exclusão
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>

      <ConfirmDialog
        open={excluindo !== null}
        title="Solicitar exclusão dos dados"
        message={
          excluindo
            ? `Registrar pedido de eliminação dos dados de ${excluindo.name}? O pedido vai para avaliação da empresa: a lei preserva o que for necessário à obrigação fiscal (Art. 16), e faturas em aberto bloqueiam a execução.`
            : ''
        }
        confirmLabel="Registrar pedido"
        loading={esquecer.pending}
        onConfirm={() => void onForget()}
        onCancel={() => {
          setExcluindo(null);
          esquecer.reset();
        }}
      />
    </div>
  );
}
