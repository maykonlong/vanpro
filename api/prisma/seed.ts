import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { runUnscoped } from '../src/lib/request-context';
import { logger } from '../src/lib/logger';
import { toCents } from '../src/lib/money';

/**
 * Semente de dados REAIS no PostgreSQL.
 *
 * Nao e mock: e dado gravado no banco de verdade, pelo mesmo cliente Prisma que
 * a API usa, passando pelo mesmo tenant-guard e pela mesma criptografia de
 * campo. Nada aqui e devolvido por um `if (mock)` no controller.
 *
 * ─── Por que o volume importa ─────────────────────────────────────────────
 *
 * A versao anterior criava 2 empresas e 4 alunos. Isso e suficiente para o
 * teste automatizado e insuficiente para QUALQUER julgamento sobre o produto:
 * com 4 alunos a lista nunca pagina, o DRE cabe numa linha, o grafico de
 * inadimplencia nao tem forma e nenhuma consulta chega perto de usar indice.
 * Problema de N+1, ordenacao de nome com acento e filtro que esqueceu o
 * companyId so aparecem com dezenas de linhas — e todos eles aparecem em
 * producao, no primeiro cliente de verdade.
 *
 * Tres empresas de proposito: com DUAS, um filtro trocado ("pega a outra
 * empresa") ainda parece plausivel; com tres, ele fica obviamente errado. E
 * uma delas esta em TRIAL, para o caminho de bloqueio por plano existir no
 * banco em vez de existir so no diagrama.
 *
 * Uma motorista (Joana) trabalha em DUAS empresas de proposito: e o caso de
 * freelancer que o produto promete suportar e que quebra implementacao ingenua
 * de multi-tenancy.
 */

const SENHA_DEMO = 'VanPro@Demo2026';

/**
 * Id estavel derivado de uma chave natural.
 *
 * A primeira versao procurava o registro por campo de exibicao (escola + serie)
 * antes de criar. Bastou corrigir a acentuacao de "Colegio" para "Colégio" para
 * a busca nao casar mais e o seed DUPLICAR alunos e mensalidades — o problema
 * classico de usar dado mutavel como chave.
 *
 * Com UUIDv5 sobre uma chave que nao muda, `upsert` por id converge sempre:
 * rodar o seed dez vezes deixa o banco igual a rodar uma.
 */
const NAMESPACE = '6f1c2a54-0b3d-4e7a-9c15-8d2f4b6e0a91';
function idFixo(...partes: string[]): string {
  const hash = crypto.createHash('sha1').update(`${NAMESPACE}:${partes.join('|')}`).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50; // versao 5
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Sorteio DETERMINISTICO a partir de uma chave.
 *
 * `Math.random()` aqui destruiria a idempotencia: cada execucao produziria
 * mensalidade e quilometragem diferentes para o MESMO id, e o `update` do
 * upsert reescreveria o banco inteiro toda vez — inclusive numa demonstracao
 * em andamento. Derivando o numero da mesma chave que gera o id, o dado varia
 * entre registros e nao varia entre execucoes.
 */
function sorteio(chave: string, min: number, max: number): number {
  const h = crypto.createHash('sha256').update(chave).digest();
  const fracao = h.readUInt32BE(0) / 0xffffffff;
  return min + Math.round(fracao * (max - min));
}

/** Primeiro dia do mes, `n` meses atras. Ancora estavel para as series temporais. */
function mesAtras(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return d;
}

/** Dia util `n` dias atras (pula sabado e domingo, andando para tras). */
function diaUtilAtras(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  let restantes = n;
  while (restantes > 0) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) restantes--;
  }
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

function comHora(base: Date, hora: number, minuto: number): Date {
  const d = new Date(base);
  d.setHours(hora, minuto, 0, 0);
  return d;
}

// ─── Vocabulario brasileiro plausivel ──────────────────────────────────────
const NOMES = [
  'Lucas Rodrigues', 'Beatriz Rodrigues', 'Enzo Cardoso', 'Manuela Freitas',
  'Miguel Nogueira', 'Helena Barbosa', 'Arthur Siqueira', 'Laura Vasconcelos',
  'Théo Menezes', 'Alice Fontoura', 'Gabriel Peixoto', 'Cecília Andrade',
  'Bernardo Quirino', 'Isabela Tavares', 'Heitor Rezende', 'Maitê Camargo',
  'Davi Lucca Moreira', 'Sophia Bittencourt', 'Pedro Henrique Fialho', 'Antonella Braga',
  'Samuel Assunção', 'Valentina Pereira', 'Benício Salgado', 'Heloísa Padilha',
  'Anthony Gadelha', 'Eloá Vieira', 'Isaac Bandeira', 'Lívia Sacramento',
  'Joaquim Estrela', 'Maria Clara Rocha', 'Rafael Trindade', 'Yasmin Aragão',
  'Nicolas Lustosa', 'Rebeca Vilanova', 'Vicente Portela', 'Lorena Guimarães',
  'Otávio Bezerra', 'Clarice Medeiros', 'Caio Mesquita', 'Júlia Sobral',
  // Os quatro ultimos sao da frota inadimplente (ver "Vai e Vem" abaixo).
  'Emanuel Tourinho', 'Aurora Belchior', 'Leonardo Praxedes', 'Marina Doria',
];

const ESCOLAS = [
  'Colégio Dom Pedro II', 'Escola Vila Nova', 'Instituto Aurora',
  'Colégio Santa Inês', 'EMEF Paulo Freire', 'Colégio Objetivo Sul',
];

const SERIES = ['1º Ano A', '2º Ano B', '3º Ano A', '4º Ano C', '5º Ano A', '6º Ano B', '7º Ano A', '8º Ano C', '9º Ano B'];

const RUAS = [
  'Rua Haddock Lobo', 'Av. Rebouças', 'Rua Cardeal Arcoverde', 'Av. Pompéia',
  'Rua Teodoro Sampaio', 'Av. Faria Lima', 'Rua Aurora', 'Av. Angélica',
  'Rua Barão de Jundiaí', 'Av. Nossa Senhora de Fátima',
];

/**
 * Segredo TOTP do administrador de demonstracao. Base32, formato do otplib.
 * Documentado no README junto das contas — nao e credencial de producao.
 */
const SEGREDO_2FA_DEMO = 'KRSXG5CTMVRXEZLUGE3TMNZS';

async function main() {
  await runUnscoped('seed', async () => {
    const senha = await bcrypt.hash(SENHA_DEMO, 12);

    // --- planos -----------------------------------------------------------
    const [free, pro] = await Promise.all([
      prisma.subscriptionPlan.upsert({
        where: { name: 'FREE' },
        update: {},
        create: { name: 'FREE', maxVehicles: 2, maxDrivers: 3, maxStudents: 30, priceCents: 0 },
      }),
      prisma.subscriptionPlan.upsert({
        where: { name: 'PRO' },
        update: {},
        create: { name: 'PRO', maxVehicles: 20, maxDrivers: 40, maxStudents: 500, priceCents: toCents(249.9) },
      }),
    ]);

    /*
     * --- plataforma -------------------------------------------------------
     *
     * O administrador da plataforma nasce com SEGUNDO FATOR ATIVO, e o segredo
     * TOTP e conhecido (`SEGREDO_2FA_DEMO`).
     *
     * O console da plataforma suspende qualquer frota cliente e enxerga o
     * tamanho de todas — senha sozinha protegendo isso significa que uma
     * credencial vazada tira do ar todos os clientes de uma vez. O servidor
     * exige o segundo fator nessa porta (`platform.controller.ts`), entao o
     * dado de demonstracao precisa refletir o estado real de uso: sem isto, a
     * unica conta capaz de operar o console seria a unica que nao consegue
     * entrar nele.
     *
     * O segredo e fixo porque este e o ambiente de demonstracao e a suite de
     * ponta a ponta precisa gerar o codigo. Em producao ele nasce do
     * `authenticator.generateSecret()` no fluxo de ativacao, por usuario.
     */
    await prisma.user.upsert({
      where: { email: 'admin@vanpro.com.br' },
      update: { isTwoFactorEnabled: true, twoFactorSecret: SEGREDO_2FA_DEMO },
      create: {
        name: 'Administrador da Plataforma',
        email: 'admin@vanpro.com.br',
        password: senha,
        role: 'SUPER_ADMIN',
        tenantId: null,
        isTwoFactorEnabled: true,
        twoFactorSecret: SEGREDO_2FA_DEMO,
      },
    });

    // --- empresas ---------------------------------------------------------
    const transvan = await prisma.company.upsert({
      where: { document: '11222333000181' },
      update: {},
      create: {
        name: 'TransVan Escolar',
        document: '11222333000181',
        subscriptionId: pro.id,
        tenantStatus: 'ACTIVE',
        latitude: -23.5613,
        longitude: -46.6565,
      },
    });

    const rotaSegura = await prisma.company.upsert({
      where: { document: '44555666000199' },
      update: {},
      create: {
        name: 'Rota Segura Transportes',
        document: '44555666000199',
        subscriptionId: pro.id,
        tenantStatus: 'ACTIVE',
        latitude: -23.5985,
        longitude: -46.6885,
      },
    });

    // A terceira fica em TRIAL de proposito: o caminho de bloqueio por plano
    // (limite de alunos, aviso de fim de teste) so e exercitavel se existir uma
    // empresa nesse estado no banco.
    const caminhoSeguro = await prisma.company.upsert({
      where: { document: '77888999000122' },
      update: {},
      create: {
        name: 'Caminho Seguro Transporte Escolar',
        document: '77888999000122',
        subscriptionId: free.id,
        tenantStatus: 'TRIAL',
        trialEndsAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
        latitude: -22.9056,
        longitude: -47.0608,
      },
    });

    /*
     * A quarta empresa existe SUSPENSA, e nao por acidente.
     *
     * Um SaaS de verdade sempre tem inadimplente, e o modo somente-leitura e o
     * caminho mais delicado do produto: a conta continua abrindo, os dados
     * continuam visiveis, escrita nenhuma passa — exceto ponto do motorista e
     * check-in de aluno, que nao podem parar porque a van ja esta na rua com
     * crianca dentro. Sem uma empresa nesse estado no banco, esse caminho
     * inteiro so podia ser lido, nunca exercitado, e o teste
     * correspondente vivia declarado como NAO VERIFICADO.
     */
    const vaiEVem = await prisma.company.upsert({
      where: { document: '10203040000155' },
      update: {},
      create: {
        name: 'Vai e Vem Transporte Escolar',
        document: '10203040000155',
        subscriptionId: free.id,
        tenantStatus: 'SUSPENDED',
        latitude: -23.5329,
        longitude: -46.7918,
      },
    });

    async function pessoa(
      email: string,
      name: string,
      role: 'OWNER' | 'MANAGER' | 'DRIVER' | 'ASSISTANT' | 'PARENT',
      companyId: string,
      flags: Partial<{ canManageFinance: boolean; canManageHR: boolean; canManageRoutes: boolean }> = {},
      contractType: 'FULL_TIME' | 'FREELANCE' = 'FULL_TIME',
    ) {
      const user = await prisma.user.upsert({
        where: { email },
        // Converge o nome exibido, e so ele. Reexecutar o seed nao pode
        // reescrever senha nem papel de alguem que ja usa o ambiente — mas um
        // seed que nunca atualiza nada deixa o dado de demonstracao velho para
        // sempre, que foi o que aconteceu ao corrigir a acentuacao.
        update: { name },
        create: { name, email, password: senha, role, tenantId: companyId },
      });
      await prisma.userCompany.upsert({
        where: { userId_companyId: { userId: user.id, companyId } },
        update: {},
        create: {
          userId: user.id,
          companyId,
          role,
          status: 'ACTIVE',
          contractType,
          canManageFinance: flags.canManageFinance ?? role === 'OWNER',
          canManageHR: flags.canManageHR ?? role === 'OWNER',
          canManageRoutes: flags.canManageRoutes ?? role === 'OWNER',
        },
      });
      return user;
    }

    // Empresa A — quadro completo, um papel de cada.
    const roberto = await pessoa('roberto@transvan.com.br', 'Roberto Almeida', 'OWNER', transvan.id);
    await pessoa('secretaria@transvan.com.br', 'Patrícia Nunes', 'MANAGER', transvan.id, {
      canManageFinance: true,
      canManageHR: false,
      canManageRoutes: false, // delegacao parcial: mostra a feature flag funcionando
    });
    const carlos = await pessoa('carlos@transvan.com.br', 'Carlos Oliveira', 'DRIVER', transvan.id);
    const eduardo = await pessoa('eduardo@transvan.com.br', 'Eduardo Sampaio', 'DRIVER', transvan.id);
    const marcia = await pessoa('marcia@transvan.com.br', 'Márcia Lopes', 'DRIVER', transvan.id);
    await pessoa('monitora@transvan.com.br', 'Sílvia Ramos', 'ASSISTANT', transvan.id);
    const maria = await pessoa('maria@exemplo.com.br', 'Maria Rodrigues', 'PARENT', transvan.id);

    // Empresa B — inclui a motorista freelancer que atende as duas.
    const helenaP = await pessoa('helena@rotasegura.com.br', 'Helena Prado', 'OWNER', rotaSegura.id);
    await pessoa('financeiro@rotasegura.com.br', 'Rogério Batista', 'MANAGER', rotaSegura.id, {
      canManageFinance: true,
    });
    const joana = await pessoa('joana@freelancer.com.br', 'Joana Martins', 'DRIVER', rotaSegura.id, {}, 'FREELANCE');
    const wagner = await pessoa('wagner@rotasegura.com.br', 'Wagner Teixeira', 'DRIVER', rotaSegura.id);
    const cristina = await pessoa('cristina@rotasegura.com.br', 'Cristina Aguiar', 'DRIVER', rotaSegura.id);
    await prisma.userCompany.upsert({
      where: { userId_companyId: { userId: joana.id, companyId: transvan.id } },
      update: {},
      create: {
        userId: joana.id,
        companyId: transvan.id,
        role: 'DRIVER',
        status: 'ACTIVE',
        contractType: 'FREELANCE',
      },
    });
    const joao = await pessoa('joao.pai@exemplo.com.br', 'João Pereira', 'PARENT', rotaSegura.id);

    // Empresa C — enxuta, como e uma frota que acabou de comecar.
    const sandra = await pessoa('sandra@caminhoseguro.com.br', 'Sandra Vilela', 'OWNER', caminhoSeguro.id);
    const jefferson = await pessoa('jefferson@caminhoseguro.com.br', 'Jefferson Muniz', 'DRIVER', caminhoSeguro.id);
    const talita = await pessoa('talita@caminhoseguro.com.br', 'Talita Ferro', 'DRIVER', caminhoSeguro.id);
    const denise = await pessoa('denise@exemplo.com.br', 'Denise Cavalcanti', 'PARENT', caminhoSeguro.id);

    // Frota inadimplente: dono, um motorista e um responsavel. Pouca gente de
    // proposito — o que precisa existir aqui e o ESTADO, nao o volume.
    await pessoa('gilberto@vaievem.com.br', 'Gilberto Nazareth', 'OWNER', vaiEVem.id);
    const anderson = await pessoa('anderson@vaievem.com.br', 'Anderson Cruz', 'DRIVER', vaiEVem.id);
    const solange = await pessoa('solange@exemplo.com.br', 'Solange Bittar', 'PARENT', vaiEVem.id);

    // --- frota ------------------------------------------------------------
    const frota = [
      { c: transvan, plate: 'ABC1D23', model: 'Ford Transit Executive 2024', capacity: 15, status: 'IDLE' },
      { c: transvan, plate: 'XYZ9E87', model: 'Mercedes-Benz Sprinter 516', capacity: 19, status: 'MAINTENANCE' },
      { c: transvan, plate: 'RQT2H10', model: 'Renault Master Escolar 2023', capacity: 16, status: 'ON_ROUTE' },
      { c: rotaSegura, plate: 'KRM4F55', model: 'Renault Master Minibus', capacity: 16, status: 'IDLE' },
      { c: rotaSegura, plate: 'JLP7B31', model: 'Iveco Daily City 2022', capacity: 20, status: 'ON_ROUTE' },
      { c: rotaSegura, plate: 'GVD3C94', model: 'Fiat Ducato Escolar 2021', capacity: 15, status: 'IDLE' },
      { c: caminhoSeguro, plate: 'PBS5K27', model: 'Peugeot Boxer Minibus 2020', capacity: 15, status: 'IDLE' },
      { c: caminhoSeguro, plate: 'MNC8L46', model: 'Volkswagen Kombi Escolar 2013', capacity: 9, status: 'MAINTENANCE' },
      { c: vaiEVem, plate: 'TFR6J82', model: 'Citroën Jumper Escolar 2019', capacity: 16, status: 'IDLE' },
    ];

    const veiculos = new Map<string, { id: string; companyId: string }>();
    for (const v of frota) {
      const registro = await prisma.vehicle.upsert({
        where: { companyId_plate: { companyId: v.c.id, plate: v.plate } },
        update: { model: v.model, status: v.status },
        create: {
          companyId: v.c.id,
          plate: v.plate,
          model: v.model,
          capacity: v.capacity,
          km: sorteio(`km:${v.plate}`, 18_000, 190_000),
          status: v.status,
        },
      });
      veiculos.set(v.plate, { id: registro.id, companyId: v.c.id });
    }

    // --- motoristas -------------------------------------------------------
    // A chave e (empresa, usuario): a mesma pessoa tem um cadastro de motorista
    // por frota. Joana aparece DUAS vezes, com diaria diferente em cada uma —
    // o caso que o produto promete e que a versao anterior nao representava.
    const quadro = [
      { c: transvan, u: carlos, nome: 'Carlos Oliveira', turno: 'FULL', diaria: 180 },
      { c: transvan, u: eduardo, nome: 'Eduardo Sampaio', turno: 'MORNING', diaria: 170 },
      { c: transvan, u: marcia, nome: 'Márcia Lopes', turno: 'AFTERNOON', diaria: 165 },
      { c: transvan, u: joana, nome: 'Joana Martins', turno: 'MORNING', diaria: 200 },
      { c: rotaSegura, u: joana, nome: 'Joana Martins', turno: 'AFTERNOON', diaria: 160 },
      { c: rotaSegura, u: wagner, nome: 'Wagner Teixeira', turno: 'FULL', diaria: 175 },
      { c: rotaSegura, u: cristina, nome: 'Cristina Aguiar', turno: 'MORNING', diaria: 158 },
      { c: caminhoSeguro, u: jefferson, nome: 'Jefferson Muniz', turno: 'FULL', diaria: 150 },
      { c: caminhoSeguro, u: talita, nome: 'Talita Ferro', turno: 'AFTERNOON', diaria: 145 },
      { c: vaiEVem, u: anderson, nome: 'Anderson Cruz', turno: 'FULL', diaria: 155 },
    ];

    const motoristas: { id: string; companyId: string; nome: string }[] = [];
    for (const m of quadro) {
      const registro = await prisma.driver.upsert({
        where: { companyId_userId: { companyId: m.c.id, userId: m.u.id } },
        update: { name: m.nome },
        create: {
          companyId: m.c.id,
          userId: m.u.id,
          name: m.nome,
          shiftType: m.turno,
          dailyRateCents: toCents(m.diaria),
        },
      });
      motoristas.push({ id: registro.id, companyId: m.c.id, nome: m.nome });
    }

    // --- alunos, mensalidades e faturas -----------------------------------
    //
    // Seis meses de historico, e nao tres: e o minimo para o DRE mostrar
    // tendencia e para a inadimplencia ter forma (um mes ruim isolado nao se
    // distingue de erro de lancamento).
    //
    // A regra de inadimplencia e deterministica e desigual de proposito: uns
    // poucos alunos atrasam SEMPRE, alguns atrasaram uma vez e a maioria esta
    // em dia. Inadimplencia distribuida por igual e o padrao que dado
    // aleatorio produz e que a realidade nunca produz — e um painel calibrado
    // com ela mente sobre quem cobrar.
    const distribuicao: { empresa: typeof transvan; inicio: number; total: number; pai: string | null }[] = [
      { empresa: transvan, inicio: 0, total: 18, pai: maria.id },
      { empresa: rotaSegura, inicio: 18, total: 14, pai: joao.id },
      { empresa: caminhoSeguro, inicio: 32, total: 8, pai: denise.id },
      { empresa: vaiEVem, inicio: 40, total: 4, pai: solange.id },
    ];

    const alunosPorEmpresa = new Map<string, string[]>();

    for (const grupo of distribuicao) {
      const ids: string[] = [];
      for (let i = 0; i < grupo.total; i++) {
        const indice = grupo.inicio + i;
        const nome = NOMES[indice]!;
        const chave = `${grupo.empresa.document}:${indice}`;
        const studentId = idFixo('student', grupo.empresa.document, String(i));
        const mensalidade = sorteio(`fee:${chave}`, 380, 620);
        const escola = ESCOLAS[sorteio(`escola:${chave}`, 0, ESCOLAS.length - 1)]!;
        const serie = SERIES[sorteio(`serie:${chave}`, 0, SERIES.length - 1)]!;
        const turno = i % 3 === 2 ? 'AFTERNOON' : 'MORNING';
        const rua = RUAS[sorteio(`rua:${chave}`, 0, RUAS.length - 1)]!;
        const numero = sorteio(`numero:${chave}`, 20, 1800);

        const aluno = await prisma.student.upsert({
          where: { id: studentId },
          update: {
            name: nome,
            school: escola,
            grade: serie,
            monthlyFeeCents: toCents(mensalidade),
          },
          create: {
            id: studentId,
            companyId: grupo.empresa.id,
            name: nome,
            school: escola,
            grade: serie,
            shift: turno,
            monthlyFeeCents: toCents(mensalidade),
            // Só os tres primeiros de cada empresa tem responsavel com login:
            // no mundo real a maioria dos pais nunca cria conta, e uma base em
            // que todos tem vira um teste que nunca exercita o aluno orfao.
            parentId: i < 3 ? grupo.pai : null,
            address: `${rua}, ${numero} — São Paulo/SP`,
            dateOfBirth: new Date(2011 + (indice % 8), indice % 12, 1 + (indice % 27)),
            lgpdConsent: true,
            imageConsent: indice % 4 !== 0,
            consentDate: mesAtras(6),
            latitude: -23.5563 - (indice % 12) * 0.004,
            longitude: -46.6625 + (indice % 9) * 0.003,
          },
        });
        ids.push(aluno.id);

        // Perfil de pagamento estavel por aluno.
        const perfil = sorteio(`perfil:${chave}`, 0, 99);
        const sempreAtrasa = perfil >= 92; // ~8% da base
        const atrasouUmaVez = perfil >= 75 && perfil < 92;
        const mesDoAtraso = sorteio(`mesatraso:${chave}`, 0, 5);

        for (let m = 5; m >= 0; m--) {
          const vencimento = mesAtras(m);
          vencimento.setDate(10);
          const emAberto = sempreAtrasa || (atrasouUmaVez && m === mesDoAtraso) || m === 0;
          const pago = !emAberto;

          const lancamentoId = idFixo('financial', aluno.id, String(m));
          await prisma.financialTransaction.upsert({
            where: { id: lancamentoId },
            update: {
              amountCents: toCents(mensalidade),
              paid: pago,
              paidAt: pago ? vencimento : null,
              dueDate: vencimento,
            },
            create: {
              id: lancamentoId,
              companyId: grupo.empresa.id,
              studentId: aluno.id,
              amountCents: toCents(mensalidade),
              paid: pago,
              paidAt: pago ? vencimento : null,
              dueDate: vencimento,
            },
          });
        }

        // Fatura do mes corrente para quem esta em atraso cronico: e o registro
        // que a tela de cobranca lista. Sem `gatewayId` — nao ha gateway ligado
        // neste ambiente, e inventar um id de cobranca seria exatamente o
        // "identificador simulado" que o guarda 2 proibe.
        if (sempreAtrasa) {
          const vencimento = mesAtras(1);
          vencimento.setDate(10);
          const faturaId = idFixo('invoice', aluno.id, 'atraso');
          await prisma.invoice.upsert({
            where: { id: faturaId },
            update: { amountCents: toCents(mensalidade), status: 'OVERDUE', dueDate: vencimento },
            create: {
              id: faturaId,
              companyId: grupo.empresa.id,
              studentId: aluno.id,
              amountCents: toCents(mensalidade),
              status: 'OVERDUE',
              dueDate: vencimento,
            },
          });
        }
      }
      alunosPorEmpresa.set(grupo.empresa.id, ids);
    }

    // --- ponto (varios dias) ----------------------------------------------
    //
    // Cinco dias uteis por motorista, com as quatro batidas do dia. O cartao de
    // ponto e o que a jornada trabalhista exige: um unico dia no banco faz o
    // relatorio de horas parecer certo enquanto qualquer soma por periodo
    // continua sem ser exercitada.
    const veiculoPorEmpresa = new Map<string, string[]>();
    for (const [placa, v] of veiculos) {
      const lista = veiculoPorEmpresa.get(v.companyId) ?? [];
      lista.push(placa);
      veiculoPorEmpresa.set(v.companyId, lista);
    }

    for (const motorista of motoristas) {
      const placas = veiculoPorEmpresa.get(motorista.companyId) ?? [];
      if (placas.length === 0) continue;

      for (let d = 1; d <= 5; d++) {
        const dia = diaUtilAtras(d);
        const placa = placas[(d + motorista.nome.length) % placas.length]!;
        const veiculo = veiculos.get(placa)!;
        const cartaoId = idFixo('timecard', motorista.id, String(d));

        // O dia mais recente fica ABERTO num motorista de cada empresa: e o
        // estado que o painel "em rota agora" precisa mostrar, e o unico em que
        // o calculo de horas tem de lidar com saida ausente.
        const aberto = d === 1 && motorista.nome.startsWith('Carlos');

        await prisma.timecard.upsert({
          where: { id: cartaoId },
          update: { status: aberto ? 'IN_PROGRESS' : 'COMPLETED', date: dia },
          create: {
            id: cartaoId,
            companyId: motorista.companyId,
            driverId: motorista.id,
            vehicleId: veiculo.id,
            status: aberto ? 'IN_PROGRESS' : 'COMPLETED',
            date: dia,
          },
        });

        const kmInicial = sorteio(`kmdia:${motorista.id}:${d}`, 40_000, 120_000);
        const batidas: { tipo: string; hora: number; minuto: number; km: number | null }[] = [
          { tipo: 'CLOCK_IN', hora: 6, minuto: 20, km: kmInicial },
          { tipo: 'BREAK_START', hora: 9, minuto: 5, km: null },
          { tipo: 'BREAK_END', hora: 11, minuto: 40, km: null },
          { tipo: 'CLOCK_OUT', hora: 18, minuto: 10, km: kmInicial + sorteio(`kmrod:${motorista.id}:${d}`, 45, 130) },
        ];

        for (const [ordem, b] of batidas.entries()) {
          if (aberto && ordem > 1) break;
          const batidaId = idFixo('punch', cartaoId, String(ordem));
          await prisma.punch.upsert({
            where: { id: batidaId },
            update: { km: b.km },
            create: {
              id: batidaId,
              companyId: motorista.companyId,
              timecardId: cartaoId,
              type: b.tipo,
              km: b.km,
              createdAt: comHora(dia, b.hora, b.minuto),
              latitude: -23.5563 + ordem * 0.002,
              longitude: -46.6625 - ordem * 0.002,
            },
          });
        }
      }
    }

    // --- despesas por categoria e por mes ---------------------------------
    //
    // Seis meses, cinco categorias. O DRE sem despesa mostra margem de 100% —
    // um numero que parece bom e nao significa nada.
    const CATEGORIAS: { categoria: string; descricao: string; min: number; max: number; comVeiculo: boolean }[] = [
      { categoria: 'FUEL', descricao: 'Diesel S-10 — abastecimento do mês', min: 2_100, max: 4_800, comVeiculo: true },
      { categoria: 'MAINTENANCE', descricao: 'Manutenção preventiva e peças', min: 400, max: 2_600, comVeiculo: true },
      { categoria: 'PAYROLL', descricao: 'Folha de pagamento — motoristas e monitores', min: 6_400, max: 12_000, comVeiculo: false },
      { categoria: 'TAXES', descricao: 'IPVA, licenciamento e alvará de transporte escolar', min: 300, max: 1_500, comVeiculo: false },
      { categoria: 'OTHER', descricao: 'Seguro da frota e material de limpeza', min: 250, max: 900, comVeiculo: false },
    ];

    for (const empresa of [transvan, rotaSegura, caminhoSeguro]) {
      const placas = veiculoPorEmpresa.get(empresa.id) ?? [];
      for (let m = 5; m >= 0; m--) {
        const data = mesAtras(m);
        data.setDate(5);
        for (const cat of CATEGORIAS) {
          const chave = `${empresa.document}:${cat.categoria}:${m}`;
          const despesaId = idFixo('expense', empresa.document, cat.categoria, String(m));
          const valor = sorteio(`valor:${chave}`, cat.min, cat.max);
          const placa = cat.comVeiculo && placas.length > 0 ? placas[m % placas.length] : undefined;
          const dados = {
            companyId: empresa.id,
            description: cat.descricao,
            amountCents: toCents(valor),
            category: cat.categoria,
            date: data,
            vehicleId: placa ? veiculos.get(placa)!.id : null,
          };
          await prisma.expense.upsert({ where: { id: despesaId }, update: dados, create: { id: despesaId, ...dados } });
        }
      }
    }

    // --- fretamentos, em estados diferentes -------------------------------
    //
    // Os quatro estados no banco de uma vez. Um fretamento so em PENDING deixa
    // a coluna de concluidos vazia e a de cancelados idem — e um kanban com
    // tres colunas vazias parece defeito de carregamento, nao ausencia de dado.
    const fretamentos = [
      { empresa: transvan, chave: 'excursao', titulo: 'Excursão Praia Grande — 6º Ano', contratante: 'Colégio Dom Pedro II', preco: 2_800, inicioEm: 12, dias: 1, status: 'PENDING', placa: 'ABC1D23', motorista: 0 },
      { empresa: transvan, chave: 'museu', titulo: 'Visita ao Museu do Ipiranga — 4º Ano', contratante: 'Escola Vila Nova', preco: 1_450, inicioEm: 0, dias: 0, status: 'IN_PROGRESS', placa: 'RQT2H10', motorista: 1 },
      { empresa: transvan, chave: 'olimpiada', titulo: 'Olimpíada Escolar Regional', contratante: 'Secretaria Municipal de Educação', preco: 3_950, inicioEm: -25, dias: 2, status: 'COMPLETED', placa: 'ABC1D23', motorista: 2 },
      { empresa: rotaSegura, chave: 'teatro', titulo: 'Teatro Municipal — turmas do fundamental', contratante: 'Instituto Aurora', preco: 1_980, inicioEm: 6, dias: 0, status: 'PENDING', placa: 'JLP7B31', motorista: 4 },
      { empresa: rotaSegura, chave: 'sitio', titulo: 'Sítio pedagógico em Ibiúna', contratante: 'Colégio Santa Inês', preco: 4_200, inicioEm: -40, dias: 1, status: 'CANCELED', placa: 'KRM4F55', motorista: 5 },
      { empresa: caminhoSeguro, chave: 'zoologico', titulo: 'Zoológico de Campinas — Educação Infantil', contratante: 'EMEF Paulo Freire', preco: 1_260, inicioEm: 18, dias: 0, status: 'PENDING', placa: 'PBS5K27', motorista: 7 },
    ];

    for (const f of fretamentos) {
      const inicio = new Date();
      inicio.setHours(7, 0, 0, 0);
      inicio.setDate(inicio.getDate() + f.inicioEm);
      const fim = new Date(inicio);
      fim.setDate(fim.getDate() + f.dias);
      fim.setHours(19, 0, 0, 0);

      const fretamentoId = idFixo('charter', f.empresa.document, f.chave);
      const dados = {
        companyId: f.empresa.id,
        title: f.titulo,
        contractor: f.contratante,
        priceCents: toCents(f.preco),
        startDate: inicio,
        endDate: fim,
        status: f.status,
        vehicleId: veiculos.get(f.placa)!.id,
        driverId: motoristas[f.motorista]!.id,
      };
      await prisma.charter.upsert({
        where: { id: fretamentoId },
        update: { title: f.titulo, contractor: f.contratante, status: f.status },
        create: { id: fretamentoId, ...dados },
      });
    }

    // --- incidentes -------------------------------------------------------
    // `description` e cifrado em repouso (ver schema.prisma): e texto livre
    // escrito no calor da ocorrencia e sempre acaba com nome e endereco de
    // crianca dentro.
    const incidentes = [
      { empresa: transvan, autor: roberto, chave: 'marginal', titulo: 'Marginal Tietê interditada', desc: 'Desvio pela Av. Santos Dumont até as 9h. Avisar os responsáveis do 6º Ano sobre 20 minutos de atraso.', sev: 'HIGH' },
      { empresa: transvan, autor: roberto, chave: 'pneu', titulo: 'Pneu furado na Rua Aurora', desc: 'Van ABC1D23 com pneu furado às 7h15; alunos transferidos para a RQT2H10 sem intercorrência.', sev: 'MEDIUM' },
      { empresa: transvan, autor: roberto, chave: 'malestar', titulo: 'Aluno passou mal a bordo', desc: 'Aluno do 3º Ano com enjoo na esquina da Haddock Lobo; mãe acionada e criança entregue em casa.', sev: 'CRITICAL' },
      { empresa: rotaSegura, autor: helenaP, chave: 'chuva', titulo: 'Alagamento na Av. Faria Lima', desc: 'Rota da tarde adiada em 30 minutos por alagamento; responsáveis avisados pelo grupo da turma.', sev: 'MEDIUM' },
      { empresa: rotaSegura, autor: helenaP, chave: 'atraso', titulo: 'Atraso na saída do Instituto Aurora', desc: 'Portão liberado 25 minutos depois do combinado; conversar com a coordenação da escola.', sev: 'LOW' },
      { empresa: caminhoSeguro, autor: sandra, chave: 'documento', titulo: 'Vistoria semestral vencendo', desc: 'Vistoria da MNC8L46 vence em 12 dias. Agendar no DETRAN antes do fim do mês.', sev: 'HIGH' },
    ];

    for (const inc of incidentes) {
      const incidenteId = idFixo('incident', inc.empresa.document, inc.chave);
      const dados = {
        companyId: inc.empresa.id,
        title: inc.titulo,
        description: inc.desc,
        severity: inc.sev,
        createdById: inc.autor.id,
      };
      await prisma.incidentAlert.upsert({
        where: { id: incidenteId },
        update: dados,
        create: { id: incidenteId, ...dados },
      });
    }

    // --- mensagens da equipe ----------------------------------------------
    const mensagens = [
      { empresa: transvan, autor: roberto, chave: 'm1', texto: 'Bom dia, equipe. Reunião de rota hoje às 14h na garagem.', diasAtras: 4 },
      { empresa: transvan, autor: carlos, chave: 'm2', texto: 'Combustível abastecido na ABC1D23, nota já no financeiro.', diasAtras: 3 },
      { empresa: transvan, autor: roberto, chave: 'm3', texto: 'A Joana cobre a rota da manhã na quinta. Alinhem os pontos com ela.', diasAtras: 1 },
      { empresa: rotaSegura, autor: helenaP, chave: 'm1', texto: 'Fechamento do mês na sexta. Lancem as despesas até quinta.', diasAtras: 5 },
      { empresa: rotaSegura, autor: wagner, chave: 'm2', texto: 'A KRM4F55 volta da revisão amanhã de manhã.', diasAtras: 2 },
      { empresa: caminhoSeguro, autor: sandra, chave: 'm1', texto: 'Nosso período de teste acaba em 9 dias. Vou avaliar o plano PRO.', diasAtras: 1 },
    ];

    for (const msg of mensagens) {
      const quando = new Date();
      quando.setDate(quando.getDate() - msg.diasAtras);
      const mensagemId = idFixo('message', msg.empresa.document, msg.chave);
      await prisma.teamMessage.upsert({
        where: { id: mensagemId },
        update: { content: msg.texto },
        create: {
          id: mensagemId,
          companyId: msg.empresa.id,
          senderId: msg.autor.id,
          senderName: msg.autor.name,
          content: msg.texto,
          createdAt: quando,
        },
      });
    }

    // --- observacoes sobre alunos (cifradas, sigilosas) -------------------
    const observacoes = [
      { empresa: transvan, autor: roberto, indice: 0, texto: 'Alergia a amendoim. Lanche nunca pode ser dividido a bordo.' },
      { empresa: transvan, autor: roberto, indice: 4, texto: 'Desce no ponto da avó às terças e quintas, conforme autorização assinada.' },
      { empresa: rotaSegura, autor: helenaP, indice: 1, texto: 'Usa aparelho auditivo; confirmar sempre olhando para a criança.' },
      { empresa: caminhoSeguro, autor: sandra, indice: 2, texto: 'Guarda compartilhada: semana par com a mãe, semana ímpar com o pai.' },
    ];

    for (const obs of observacoes) {
      const alunos = alunosPorEmpresa.get(obs.empresa.id) ?? [];
      const alunoId = alunos[obs.indice];
      if (!alunoId) continue;
      const notaId = idFixo('note', alunoId, String(obs.indice));
      await prisma.note.upsert({
        where: { id: notaId },
        update: { content: obs.texto },
        create: {
          id: notaId,
          companyId: obs.empresa.id,
          studentId: alunoId,
          authorId: obs.autor.id,
          content: obs.texto,
          isSecret: true,
        },
      });
    }

    // Contagem MEDIDA no banco, e nao digitada no log.
    //
    // Um seed que anuncia "40 alunos" porque o numero esta escrito na string
    // continua anunciando 40 depois de um erro que gravou 12 — e o operador
    // acredita no log, nao no banco.
    const [empresas, usuarios, alunos, veiculosTotal, motoristasTotal, cartoes, lancamentos, despesas] =
      await Promise.all([
        prisma.company.count(),
        prisma.user.count(),
        prisma.student.count(),
        prisma.vehicle.count(),
        prisma.driver.count(),
        prisma.timecard.count(),
        prisma.financialTransaction.count(),
        prisma.expense.count(),
      ]);

    const emAberto = await prisma.financialTransaction.count({ where: { paid: false } });

    logger.info(
      {
        empresas,
        usuarios,
        alunos,
        veiculos: veiculosTotal,
        motoristas: motoristasTotal,
        cartoesDePonto: cartoes,
        mensalidades: lancamentos,
        mensalidadesEmAberto: emAberto,
        despesas,
        senhaDemo: SENHA_DEMO,
      },
      'seed concluido',
    );
  });
}

main()
  .catch((err) => {
    logger.fatal({ err }, 'seed falhou');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
