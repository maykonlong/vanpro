import { useState } from 'react';
import type { FormEvent } from 'react';
import { Users } from 'lucide-react';

import { api } from '../../lib/api';
import { label, parseBrlToCents } from '../../lib/format';
import { useAction, useResource } from '../../hooks/useResource';
import { useAuth } from '../../context/AuthContext';
import { PhotoUpload, photoSrc } from '../../components/PhotoUpload';
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
import type { Paginated, Shift, Student } from '../../lib/types';

interface FormState {
  name: string;
  school: string;
  grade: string;
  shift: Shift;
  monthlyFee: string;
  address: string;
  dateOfBirth: string;
  lgpdConsent: boolean;
  imageConsent: boolean;
  photoUrl: string | null;
}

const EMPTY_FORM: FormState = {
  name: '',
  school: '',
  grade: '',
  shift: 'MORNING',
  monthlyFee: '',
  address: '',
  dateOfBirth: '',
  lgpdConsent: false,
  imageConsent: false,
  photoUrl: null,
};

function toForm(student: Student): FormState {
  return {
    name: student.name,
    school: student.school,
    grade: student.grade,
    shift: student.shift,
    // A API devolve centavos; o formulario trabalha em reais para o usuario.
    monthlyFee: (student.monthlyFee.cents / 100).toFixed(2).replace('.', ','),
    address: student.address ?? '',
    dateOfBirth: student.dateOfBirth ? student.dateOfBirth.slice(0, 10) : '',
    lgpdConsent: student.lgpdConsent,
    imageConsent: student.imageConsent,
    photoUrl: student.photoUrl,
  };
}

export function Students() {
  const { hasPermission, hasRole } = useAuth();
  const podeEditar = hasPermission('canManageRoutes');
  // Excluir aluno é exclusivo do proprietário no servidor. Mostrar o botão a
  // quem vai levar 403 é oferecer uma ação que não existe.
  const podeExcluir = hasRole('OWNER');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [shift, setShift] = useState('');
  const [editing, setEditing] = useState<Student | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [removing, setRemoving] = useState<Student | null>(null);

  const list = useResource<Paginated<Student>>(
    (signal) => api.get('/students', { page, perPage: 20, search, shift }, signal),
    [page, search, shift],
  );

  const save = useAction();
  const remove = useAction();

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setCreating(true);
    setEditing(null);
    save.reset();
  };

  const openEdit = (student: Student) => {
    setForm(toForm(student));
    setEditing(student);
    setCreating(false);
    save.reset();
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const cents = parseBrlToCents(form.monthlyFee);
    if (cents === null) {
      save.reset();
      return;
    }

    const payload = {
      name: form.name.trim(),
      school: form.school.trim(),
      grade: form.grade.trim(),
      shift: form.shift,
      // `brlInput` do servidor aceita numero em reais; centavos vem do parse.
      monthlyFee: cents / 100,
      address: form.address.trim() || null,
      dateOfBirth: form.dateOfBirth || null,
      lgpdConsent: form.lgpdConsent,
      imageConsent: form.imageConsent,
      photoUrl: form.photoUrl,
    };

    const done = await save.run(async () => {
      if (editing) await api.patch<Student>(`/students/${editing.id}`, payload);
      else await api.post<Student>('/students', payload);
      return true;
    });

    if (done) {
      closeForm();
      list.reload();
    }
  };

  const onDelete = async () => {
    if (!removing) return;
    const done = await remove.run(async () => {
      await api.del(`/students/${removing.id}`);
      return true;
    });
    if (done) {
      setRemoving(null);
      list.reload();
    }
  };

  return (
    <div>
      <PageHeader
        title="Alunos"
        description="Cadastro, mensalidade, consentimentos de LGPD e foto."
        actions={podeEditar ? <Button onClick={openCreate}>Novo aluno</Button> : undefined}
      />

      {/*
        Sem a permissão de rotas a LISTA continua visível — o servidor libera a
        leitura para toda a gestão. Some apenas o que ela não pode fazer, com a
        explicação do porquê. Esconder a tela inteira faria a gestora achar que
        a empresa não tem aluno nenhum cadastrado.
      */}
      {!podeEditar ? (
        <div className="mb-4">
          <PermissionNotice area="O cadastro de alunos" flag="canManageRoutes" />
        </div>
      ) : null}

      <Card className="mb-4">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            list.reload();
          }}
        >
          <TextInput
            label="Buscar por escola"
            name="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            hint="O nome do aluno é cifrado no banco; a busca cobre a escola."
          />
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
        </form>
      </Card>

      {list.loading ? <SkeletonList rows={5} /> : null}
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}

      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={<Users size={30} />}
          title="Nenhum aluno cadastrado"
          description="Cadastre o primeiro aluno para gerar mensalidades, montar a lista de embarque e habilitar o acompanhamento do responsável."
          action={podeEditar ? <Button onClick={openCreate}>Cadastrar aluno</Button> : undefined}
        />
      ) : null}

      {list.data && list.data.items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2">
            {list.data.items.map((student) => (
              <li key={student.id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    {photoSrc(student.photoUrl) ? (
                      <img
                        src={photoSrc(student.photoUrl) ?? ''}
                        alt={`Foto de ${student.name}`}
                        className="h-12 w-12 rounded-full border border-ink-700 object-cover"
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-800 text-sm text-ink-400"
                      >
                        {student.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-ink-50">{student.name}</p>
                      <p className="text-xs text-ink-400">
                        {student.school} · {label.shift(student.shift)} · {student.monthlyFee.formatted}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={student.lgpdConsent ? 'good' : 'warn'}>
                      {student.lgpdConsent ? 'LGPD ok' : 'Sem consentimento'}
                    </Badge>
                    <Badge tone={student.status === 'ABSENT' ? 'bad' : 'neutral'}>
                      {label.studentStatus(student.status)}
                    </Badge>
                    {podeEditar ? (
                      <Button variant="secondary" onClick={() => openEdit(student)}>
                        Editar<span className="sr-only"> {student.name}</span>
                      </Button>
                    ) : null}
                    {podeExcluir ? (
                      <Button variant="danger" onClick={() => setRemoving(student)}>
                        Excluir<span className="sr-only"> {student.name}</span>
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
        title={editing ? 'Editar aluno' : 'Novo aluno'}
        onClose={closeForm}
      >
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <InlineError message={save.error} />

          <TextInput
            label="Nome"
            name="name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={save.fieldErrors.name}
          />
          <TextInput
            label="Escola"
            name="school"
            required
            value={form.school}
            onChange={(e) => setForm({ ...form, school: e.target.value })}
            error={save.fieldErrors.school}
          />
          <TextInput
            label="Série"
            name="grade"
            value={form.grade}
            onChange={(e) => setForm({ ...form, grade: e.target.value })}
            error={save.fieldErrors.grade}
          />
          <SelectInput
            label="Turno"
            name="shift"
            value={form.shift}
            onChange={(e) => setForm({ ...form, shift: e.target.value as Shift })}
            error={save.fieldErrors.shift}
          >
            <option value="MORNING">Manhã</option>
            <option value="AFTERNOON">Tarde</option>
            <option value="FULL">Integral</option>
          </SelectInput>
          <TextInput
            label="Mensalidade (R$)"
            name="monthlyFee"
            inputMode="decimal"
            required
            value={form.monthlyFee}
            onChange={(e) => setForm({ ...form, monthlyFee: e.target.value })}
            error={save.fieldErrors.monthlyFee}
            hint="Guardada em centavos: não há arredondamento de ponto flutuante."
          />
          <TextInput
            label="Endereço"
            name="address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            error={save.fieldErrors.address}
          />
          <TextInput
            label="Data de nascimento"
            name="dateOfBirth"
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
            error={save.fieldErrors.dateOfBirth}
          />

          <PhotoUpload
            value={form.photoUrl}
            onChange={(url) => setForm({ ...form, photoUrl: url })}
            label="Foto do aluno"
          />

          <fieldset className="flex flex-col gap-3 rounded-lg border border-ink-700 p-3">
            <legend className="px-1 text-sm font-medium text-ink-200">Consentimentos (LGPD)</legend>
            <label className="flex items-center gap-3 text-sm text-ink-200">
              <input
                type="checkbox"
                name="lgpdConsent"
                checked={form.lgpdConsent}
                onChange={(e) => setForm({ ...form, lgpdConsent: e.target.checked })}
              />
              Tratamento de dados autorizado pelo responsável
            </label>
            <label className="flex items-center gap-3 text-sm text-ink-200">
              <input
                type="checkbox"
                name="imageConsent"
                checked={form.imageConsent}
                onChange={(e) => setForm({ ...form, imageConsent: e.target.checked })}
              />
              Uso de imagem autorizado (obrigatório para divulgação)
            </label>
          </fieldset>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={closeForm}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.pending}>
              {editing ? 'Salvar alterações' : 'Cadastrar aluno'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title="Excluir aluno"
        message={
          removing
            ? `Remover "${removing.name}" do cadastro? A exclusão é lógica: o histórico financeiro é preservado, e faturas em aberto impedem a operação.`
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
