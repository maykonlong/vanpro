import { useState } from 'react';
import type { FormEvent } from 'react';
import { Receipt } from 'lucide-react';

import { api, ApiError } from '../../lib/api';
import { firstDayOfMonth, formatDate, label, parseBrlToCents, today } from '../../lib/format';
import { useAction, useResource } from '../../hooks/useResource';
import { useAuth } from '../../context/AuthContext';
import { useFeatures } from '../../context/FeaturesContext';
import { FeatureDisabledNotice, PermissionNotice } from '../../components/PermissionNotice';
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
import type {
  Dre,
  DreByVehicle,
  Expense,
  ExpenseCategory,
  Invoice,
  Paginated,
  Student,
  Transaction,
  Vehicle,
} from '../../lib/types';

type Aba = 'resultado' | 'mensalidades' | 'despesas' | 'faturas';

const CATEGORIAS: ExpenseCategory[] = ['FUEL', 'MAINTENANCE', 'PAYROLL', 'TAXES', 'OTHER'];

// ---------------------------------------------------------------------------
// Resultado (DRE + ROI por veiculo)
// ---------------------------------------------------------------------------

function Resultado({ from, to }: { from: string; to: string }) {
  const dre = useResource<Dre>((signal) => api.get('/financial/dre', { from, to }, signal), [from, to]);
  const roi = useResource<DreByVehicle>(
    (signal) => api.get('/financial/dre/by-vehicle', { from, to }, signal),
    [from, to],
  );
  const exportar = useAction();

  /*
   * O download passa pelo cliente de API, e não por um `<a href>`.
   *
   * Um link direto sairia sem o cabeçalho de CSRF e sem a renovação de sessão —
   * e o defeito só apareceria quinze minutos depois do login, quando o acesso
   * expira: o contador clicaria e receberia a página de erro do servidor em vez
   * do arquivo. Aqui a resposta vem como blob pelo mesmo caminho de todas as
   * outras chamadas, e só então vira arquivo no computador.
   */
  const onExportar = async () => {
    await exportar.run(async () => {
      const blob = await api.blob('/financial/export.csv', { from, to });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vanpro-financeiro-${from}-a-${to}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Sem isto o blob fica na memória da aba até ela ser fechada.
      URL.revokeObjectURL(url);
      return true;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-400">
          Período de {formatDate(from)} a {formatDate(to)}.
        </p>
        <Button variant="secondary" loading={exportar.pending} onClick={() => void onExportar()}>
          Exportar para planilha
        </Button>
      </div>
      <InlineError message={exportar.error} />
      {dre.loading ? <SkeletonList rows={2} /> : null}
      {dre.error ? <ErrorState message={dre.error} onRetry={dre.reload} /> : null}

      {dre.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <p className="text-xs uppercase tracking-wide text-ink-400">Receita</p>
            <p className="mt-2 text-2xl font-semibold text-good-400" data-testid="dre-receita">
              {dre.data.receitas.total.formatted}
            </p>
          </Card>
          <Card>
            <p className="text-xs uppercase tracking-wide text-ink-400">Despesas</p>
            <p className="mt-2 text-2xl font-semibold text-bad-400" data-testid="dre-despesa">
              {dre.data.despesaTotal.formatted}
            </p>
          </Card>
          <Card>
            <p className="text-xs uppercase tracking-wide text-ink-400">Lucro líquido</p>
            <p className="mt-2 text-2xl font-semibold text-ink-50" data-testid="dre-lucro">
              {dre.data.lucroLiquido.formatted}
            </p>
            <p className="mt-1 text-xs text-ink-400">Margem {dre.data.margemPercentual}%</p>
          </Card>
          <Card>
            <p className="text-xs uppercase tracking-wide text-ink-400">Por categoria</p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {dre.data.despesasPorCategoria.map((linha) => (
                <li key={linha.categoria} className="flex justify-between gap-2">
                  <span className="text-ink-400">{label.expenseCategory(linha.categoria)}</span>
                  <span className="text-ink-50">{linha.valor.formatted}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {/*
        O lucro acima é de CAIXA: só conta o que foi pago e registrado. Isso
        reconcilia com o extrato — e produzia um número sistematicamente
        otimista, porque a diária do motorista só entrava se alguém lembrasse de
        lançar. O trabalho aconteceu, o cartão de ponto está fechado, e o custo
        não aparecia em lugar nenhum.

        Somar a folha no lucro contaria em dobro assim que o lançamento fosse
        feito. O que se faz aqui é o contrário: deixa o número de caixa intacto
        e mostra o tamanho do que falta lançar.
      */}
      {dre.data && dre.data.folha.naoLancada.cents > 0 ? (
        <Card className="border-warn-400/40 bg-warn-soft">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-warn-400">
                Faltam {dre.data.folha.naoLancada.formatted} de diárias no resultado
              </h2>
              <span className="text-xs text-warn-400">
                {dre.data.folha.diasApurados} dia(s) de ponto fechado no período
              </span>
            </div>
            <p className="text-sm text-ink-200">
              O ponto registra <strong>{dre.data.folha.apuradaPeloPonto.formatted}</strong> em
              diárias devidas, e há{' '}
              <strong>{dre.data.folha.lancadaComoDespesa.formatted}</strong> lançado como despesa de
              folha. Enquanto a diferença existir, o lucro acima está otimista: considerando as
              diárias, ele seria{' '}
              <strong>{dre.data.lucroConsiderandoFolhaApurada.formatted}</strong>.
            </p>
            {dre.data.folha.porMotorista.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm" data-testid="dre-folha-motoristas">
                {dre.data.folha.porMotorista.map((m) => (
                  <li key={m.driverId} className="flex flex-wrap justify-between gap-2">
                    <span className="text-ink-200">
                      {m.nome} — {m.dias} dia(s) × {m.diaria.formatted}
                    </span>
                    <span className="text-ink-50">{m.total.formatted}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-ink-400">
              Lance a folha em Despesas, categoria “Folha de pagamento”, para o resultado fechar.
            </p>
          </div>
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 text-base font-semibold text-ink-50">ROI por veículo</h2>
        {roi.loading ? <SkeletonList rows={2} /> : null}
        {roi.error ? <ErrorState message={roi.error} onRetry={roi.reload} /> : null}
        {roi.data && roi.data.itens.length === 0 ? (
          <p className="text-sm text-ink-400">
            Nenhum veículo cadastrado. O ROI compara o fretamento faturado com as despesas atreladas
            a cada van — mensalidade não entra porque o aluno não é vinculado a veículo.
          </p>
        ) : null}
        {roi.data && roi.data.itens.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Resultado por veículo no período</caption>
              <thead>
                <tr className="border-b border-ink-700 text-ink-400">
                  <th scope="col" className="py-2 pr-4 font-medium">Placa</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Receita</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Despesa</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Resultado</th>
                  <th scope="col" className="py-2 font-medium">Margem</th>
                </tr>
              </thead>
              <tbody>
                {roi.data.itens.map((item) => (
                  <tr key={item.vehicleId} className="border-b border-ink-800">
                    <th scope="row" className="py-2 pr-4 font-medium text-ink-50">
                      {item.plate}
                    </th>
                    <td className="py-2 pr-4 text-good-400">{item.receita.formatted}</td>
                    <td className="py-2 pr-4 text-bad-400">{item.despesa.formatted}</td>
                    <td className="py-2 pr-4 text-ink-50">{item.resultado.formatted}</td>
                    <td className="py-2 text-ink-400">{item.margemPercentual}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mensalidades
// ---------------------------------------------------------------------------

function Mensalidades() {
  const [page, setPage] = useState(1);
  const [paid, setPaid] = useState('');
  const [creating, setCreating] = useState(false);
  const [settling, setSettling] = useState<Transaction | null>(null);
  const [studentId, setStudentId] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(today());

  const list = useResource<Paginated<Transaction>>(
    (signal) => api.get('/financial/transactions', { page, perPage: 20, paid }, signal),
    [page, paid],
  );
  const alunos = useResource<Paginated<Student>>(
    (signal) => api.get('/students', { perPage: 100 }, signal),
    [],
  );

  const create = useAction();
  const settle = useAction();

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    const cents = parseBrlToCents(amount);
    if (cents === null || !studentId) return;
    const done = await create.run(async () => {
      await api.post('/financial/transactions', {
        studentId,
        amount: cents / 100,
        dueDate,
      });
      return true;
    });
    if (done) {
      setCreating(false);
      setAmount('');
      list.reload();
    }
  };

  const onSettle = async () => {
    if (!settling) return;
    const done = await settle.run(async () => {
      await api.post(`/financial/transactions/${settling.id}/settle`);
      return true;
    });
    if (done) {
      setSettling(null);
      list.reload();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <SelectInput
            label="Situação"
            name="paid"
            value={paid}
            onChange={(e) => {
              setPaid(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            <option value="false">Em aberto</option>
            <option value="true">Pagas</option>
          </SelectInput>
        </div>
        <Button onClick={() => setCreating(true)}>Lançar mensalidade</Button>
      </div>

      {list.loading ? <SkeletonList rows={4} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<Receipt size={28} />}
          title="Nenhuma mensalidade lançada"
          description="Lance a mensalidade de um aluno para acompanhar recebimento e inadimplência. O DRE conta a entrada pela data do pagamento, não pelo vencimento."
          action={<Button onClick={() => setCreating(true)}>Lançar mensalidade</Button>}
        />
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((t) => (
              <li key={t.id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink-50">{t.amount.formatted}</p>
                    <p className="text-xs text-ink-400">
                      Vencimento {formatDate(t.dueDate)}
                      {t.paidAt ? ` · pago em ${formatDate(t.paidAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={t.paid ? 'good' : 'warn'}>{t.paid ? 'Paga' : 'Em aberto'}</Badge>
                    {!t.paid ? (
                      <Button variant="secondary" onClick={() => setSettling(t)}>
                        Dar baixa
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

      <Modal open={creating} title="Lançar mensalidade" onClose={() => setCreating(false)}>
        <form className="flex flex-col gap-4" onSubmit={onCreate} noValidate>
          <InlineError message={create.error} />
          <SelectInput
            label="Aluno"
            name="studentId"
            required
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            error={create.fieldErrors.studentId}
          >
            <option value="">Selecione</option>
            {(alunos.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.school}
              </option>
            ))}
          </SelectInput>
          <TextInput
            label="Valor (R$)"
            name="amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={create.fieldErrors.amount}
          />
          <TextInput
            label="Vencimento"
            name="dueDate"
            type="date"
            required
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            error={create.fieldErrors.dueDate}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={create.pending}>
              Lançar
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={settling !== null}
        title="Dar baixa manual"
        message={
          settling
            ? `Confirmar o recebimento de ${settling.amount.formatted}? A baixa entra na trilha de auditoria com o seu nome e não pode ser desfeita pela tela.`
            : ''
        }
        confirmLabel="Confirmar recebimento"
        loading={settle.pending}
        onConfirm={() => void onSettle()}
        onCancel={() => {
          setSettling(null);
          settle.reset();
        }}
      />
      <InlineError message={settle.error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Despesas
// ---------------------------------------------------------------------------

function Despesas({ from, to, onChanged }: { from: string; to: string; onChanged: () => void }) {
  // Excluir despesa e exclusivo do proprietario (`requireRole('OWNER')` na API).
  // A tela mostrava o botao para quem tem `canManageFinance`, entao a gestora
  // clicava, confirmava a exclusao e recebia 403 — um botao que so serve para
  // frustrar. Alunos, Frota e Fretamentos ja faziam essa distincao.
  const { hasRole } = useAuth();
  const podeExcluir = hasRole('OWNER');
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Expense | null>(null);

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [cat, setCat] = useState<ExpenseCategory>('FUEL');
  const [date, setDate] = useState(today());
  const [vehicleId, setVehicleId] = useState('');

  const list = useResource<Paginated<Expense>>(
    (signal) => api.get('/financial/expenses', { page, perPage: 20, category, from, to }, signal),
    [page, category, from, to],
  );
  const veiculos = useResource<Paginated<Vehicle>>(
    (signal) => api.get('/vehicles', { perPage: 100 }, signal),
    [],
  );

  const create = useAction();
  const remove = useAction();

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    const cents = parseBrlToCents(amount);
    if (cents === null) return;
    const done = await create.run(async () => {
      await api.post('/financial/expenses', {
        description: description.trim(),
        amount: cents / 100,
        category: cat,
        date,
        vehicleId: vehicleId || null,
      });
      return true;
    });
    if (done) {
      setCreating(false);
      setDescription('');
      setAmount('');
      list.reload();
      // O DRE muda no mesmo instante: e a razao de lancar a despesa.
      onChanged();
    }
  };

  const onDelete = async () => {
    if (!removing) return;
    const done = await remove.run(async () => {
      await api.del(`/financial/expenses/${removing.id}`);
      return true;
    });
    if (done) {
      setRemoving(null);
      list.reload();
      onChanged();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <SelectInput
            label="Categoria"
            name="category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {label.expenseCategory(c)}
              </option>
            ))}
          </SelectInput>
        </div>
        <Button onClick={() => setCreating(true)}>Lançar despesa</Button>
      </div>

      {list.loading ? <SkeletonList rows={4} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<Receipt size={28} />}
          title="Nenhuma despesa no período"
          description="Lance combustível, manutenção e folha para o DRE refletir o custo real da operação. Despesa atrelada a um veículo também alimenta o ROI por van."
          action={<Button onClick={() => setCreating(true)}>Lançar despesa</Button>}
        />
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((e) => (
              <li key={e.id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink-50">{e.description}</p>
                    <p className="text-xs text-ink-400">
                      {label.expenseCategory(e.category)} · {formatDate(e.date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-bad-400">{e.amount.formatted}</span>
                    {podeExcluir && (
                      <Button variant="danger" onClick={() => setRemoving(e)}>
                        Excluir
                      </Button>
                    )}
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

      <Modal open={creating} title="Lançar despesa" onClose={() => setCreating(false)}>
        <form className="flex flex-col gap-4" onSubmit={onCreate} noValidate>
          <InlineError message={create.error} />
          <TextInput
            label="Descrição"
            name="description"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            error={create.fieldErrors.description}
          />
          <TextInput
            label="Valor (R$)"
            name="amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={create.fieldErrors.amount}
          />
          <SelectInput
            label="Categoria"
            name="cat"
            value={cat}
            onChange={(e) => setCat(e.target.value as ExpenseCategory)}
            error={create.fieldErrors.category}
          >
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {label.expenseCategory(c)}
              </option>
            ))}
          </SelectInput>
          <TextInput
            label="Data"
            name="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            error={create.fieldErrors.date}
          />
          <SelectInput
            label="Veículo (opcional)"
            name="vehicleId"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            hint="Atrelar ao veículo é o que faz a despesa aparecer no ROI da van."
            error={create.fieldErrors.vehicleId}
          >
            <option value="">Sem veículo</option>
            {(veiculos.data?.items ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate} — {v.model}
              </option>
            ))}
          </SelectInput>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={create.pending}>
              Lançar despesa
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title="Excluir despesa"
        message={
          removing
            ? `Excluir "${removing.description}" (${removing.amount.formatted})? O DRE do período muda na hora e a exclusão fica auditada.`
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

// ---------------------------------------------------------------------------
// Faturas (cobranca no gateway)
// ---------------------------------------------------------------------------

function Faturas() {
  const { enabled, loading: flagsCarregando } = useFeatures();
  // Enquanto a sonda não responde, o botão fica indisponível: ausência de sinal
  // não é aprovação. Prometer a emissão e falhar depois é pior que esperar.
  const billingLigado = !flagsCarregando && enabled('billing');

  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(today());
  const [payerDocument, setPayerDocument] = useState('');
  const [payerName, setPayerName] = useState('');
  const [featureOff, setFeatureOff] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const list = useResource<Paginated<Invoice>>(
    (signal) => api.get('/financial/invoices', { page, perPage: 20 }, signal),
    [page],
  );
  const alunos = useResource<Paginated<Student>>(
    (signal) => api.get('/students', { perPage: 100 }, signal),
    [],
  );
  const create = useAction();

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    const cents = parseBrlToCents(amount);
    if (cents === null || !studentId) return;
    setFeatureOff(null);
    setCreated(null);
    try {
      await api.post('/financial/invoices', {
        studentId,
        amount: cents / 100,
        dueDate,
        payerDocument: payerDocument.replace(/\D/g, ''),
        payerName: payerName.trim() || undefined,
      });
      setCreating(false);
      setCreated('Cobrança gerada no gateway.');
      list.reload();
    } catch (err) {
      // 503 do gateway nao e "erro do usuario": e integracao ausente, e a tela
      // precisa dizer isso em vez de sugerir que ele digitou algo errado.
      if (err instanceof ApiError && err.code === 'FEATURE_DISABLED') {
        setFeatureOff(err.message);
        setCreating(false);
        return;
      }
      throw err;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/*
        A sonda `/health/features` diz se o gateway tem credencial NESTE
        ambiente. Saber disso antes libera desabilitar o botão com a explicação
        junto, em vez de deixar a pessoa preencher documento do pagador, valor e
        vencimento para receber um 503 no fim.
      */}
      {billingLigado ? (
        <div>
          <Button onClick={() => setCreating(true)}>Gerar cobrança Pix</Button>
        </div>
      ) : (
        <FeatureDisabledNotice
          feature="Cobrança Pix"
          detail="O gateway de pagamento não tem credencial neste ambiente, então nenhuma cobrança pode ser emitida agora. As faturas já registradas continuam listadas abaixo. Quem configura a integração é o administrador do ambiente."
        />
      )}

      <SuccessNote message={created} />
      {featureOff ? <FeatureDisabledNotice feature="Cobrança Pix" detail={featureOff} /> : null}

      {list.loading ? <SkeletonList rows={4} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<Receipt size={28} />}
          title="Nenhuma fatura emitida"
          description="Faturas são cobranças registradas no gateway de pagamento. Sem credencial configurada, a emissão é recusada — o sistema não registra cobrança que não existe do outro lado."
        />
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((i) => (
              <li key={i.id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink-50">{i.amount.formatted}</p>
                    <p className="text-xs text-ink-400">Vencimento {formatDate(i.dueDate)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={i.status === 'RECEIVED' ? 'good' : i.status === 'OVERDUE' ? 'bad' : 'warn'}>
                      {label.invoiceStatus(i.status)}
                    </Badge>
                    {i.paymentUrl ? (
                      <a
                        href={i.paymentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-brand-600 underline"
                      >
                        Abrir cobrança
                      </a>
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

      <Modal open={creating} title="Gerar cobrança Pix" onClose={() => setCreating(false)}>
        <form className="flex flex-col gap-4" onSubmit={(e) => void create.run(() => onCreate(e))} noValidate>
          <InlineError message={create.error} />
          <SelectInput
            label="Aluno"
            name="studentId"
            required
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            error={create.fieldErrors.studentId}
          >
            <option value="">Selecione</option>
            {(alunos.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
          <TextInput
            label="Valor (R$)"
            name="amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={create.fieldErrors.amount}
          />
          <TextInput
            label="Vencimento"
            name="dueDate"
            type="date"
            required
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            error={create.fieldErrors.dueDate}
          />
          <TextInput
            label="CPF/CNPJ do pagador"
            name="payerDocument"
            inputMode="numeric"
            required
            value={payerDocument}
            onChange={(e) => setPayerDocument(e.target.value)}
            error={create.fieldErrors.payerDocument}
            hint="Exigido pelo gateway; o cadastro do aluno não guarda esse dado."
          />
          <TextInput
            label="Nome do pagador"
            name="payerName"
            value={payerName}
            onChange={(e) => setPayerName(e.target.value)}
            error={create.fieldErrors.payerName}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={create.pending}>
              Gerar cobrança
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Financial() {
  const { hasPermission } = useAuth();
  const [aba, setAba] = useState<Aba>('resultado');
  const [from, setFrom] = useState(firstDayOfMonth());
  const [to, setTo] = useState(today());
  const [nonce, setNonce] = useState(0);

  if (!hasPermission('canManageFinance')) {
    return (
      <div>
        <PageHeader title="Financeiro" />
        <PermissionNotice area="O financeiro" flag="canManageFinance" variante="oculta" />
      </div>
    );
  }

  const abas: Array<{ id: Aba; texto: string }> = [
    { id: 'resultado', texto: 'Resultado' },
    { id: 'mensalidades', texto: 'Mensalidades' },
    { id: 'despesas', texto: 'Despesas' },
    { id: 'faturas', texto: 'Faturas' },
  ];

  return (
    <div>
      <PageHeader
        title="Financeiro"
        description="DRE por regime de caixa, mensalidades, despesas e cobranças."
      />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="De" name="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextInput label="Até" name="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </Card>

      <div role="tablist" aria-label="Áreas do financeiro" className="mb-4 flex flex-wrap gap-2">
        {abas.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={aba === item.id}
            onClick={() => setAba(item.id)}
            className={`min-h-[44px] rounded-lg px-4 text-sm ${
              aba === item.id ? 'bg-brand-500 font-semibold text-on-brand' : 'bg-ink-800 text-ink-200'
            }`}
          >
            {item.texto}
          </button>
        ))}
      </div>

      {aba === 'resultado' ? <Resultado key={`dre-${nonce}`} from={from} to={to} /> : null}
      {aba === 'mensalidades' ? <Mensalidades /> : null}
      {aba === 'despesas' ? (
        <Despesas from={from} to={to} onChanged={() => setNonce((n) => n + 1)} />
      ) : null}
      {aba === 'faturas' ? <Faturas /> : null}
    </div>
  );
}
