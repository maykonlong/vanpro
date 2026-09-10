# syntax=docker/dockerfile:1

# ---------- build ----------
# Imagem fixada por DIGEST, e nao so por tag.
#
# `node:22-alpine` e reescrita pelo upstream a cada patch: o mesmo Dockerfile
# produz imagens diferentes em dias diferentes, e "funciona na minha maquina"
# passa a incluir "porque a minha baixou a de terca". Pior, e o caminho por onde
# uma imagem base comprometida entra sem ninguem mudar uma linha — o vetor de
# supply chain que hoje responde pela maior parte dos incidentes em Node.
#
# A tag continua escrita ao lado do digest de proposito: ela diz o que E, o
# digest diz QUAL. Renovar e trabalho do Dependabot, que ja acompanha `docker`.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS builder
WORKDIR /app

# npm fixado, e nao "o que vier na imagem base".
#
# O npm 10.9.8 que acompanha o node:22-alpine quebra com `overrides` no
# package.json (`Cannot read properties of null (reading 'edgesOut')`), e o
# lockfile gerado por uma versao nao fecha com `npm ci` de outra. Build
# reproduzivel nao pode depender de qual npm a imagem base trouxe hoje.
RUN npm install -g npm@11.6.2

# `npm ci` (nunca `npm install`) em CI/Docker: respeita o lockfile e nao
# resolve versao nova sozinho — supply chain e o vetor numero um hoje.
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Reinstala so as de producao para nao carregar devDependencies na imagem final.
RUN npm ci --omit=dev && npx prisma generate

# ---------- runtime ----------
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runner
WORKDIR /app

ENV NODE_ENV=production

# Qual commit esta nesta imagem.
#
# `desconhecida` e o default de proposito: build sem o argumento admite que nao
# sabe, em vez de herdar um numero de outro build. Este valor e um rotulo
# DIGITADO — util, mas capaz de mentir; o carimbo derivado do conteudo, mais
# abaixo, e o que nao mente.
ARG GIT_SHA=nao-carimbada
ENV VANPRO_GIT_SHA=$GIT_SHA

# dumb-init faz PID 1 repassar SIGTERM: sem ele o Node nao recebe o sinal e o
# encerramento gracioso nunca roda — deploy corta requisicao em voo.
RUN apk add --no-cache dumb-init

# Usuario sem privilegio. Container rodando como root transforma qualquer RCE
# em controle do container.
RUN addgroup -g 10001 -S vanpro && adduser -u 10001 -S vanpro -G vanpro

COPY --from=builder --chown=vanpro:vanpro /app/node_modules ./node_modules
COPY --from=builder --chown=vanpro:vanpro /app/dist ./dist
COPY --from=builder --chown=vanpro:vanpro /app/prisma ./prisma
COPY --chown=vanpro:vanpro package.json package-lock.json conteudo-carimbado.txt ./

# O carimbo que NAO pode mentir: soma do conteudo que a imagem realmente
# carrega, calculada aqui dentro.
#
# No projeto irmao o SHA digitado ja mentiu — o health anunciava um commit
# enquanto a imagem carregava outro, e dezessete verificacoes passaram contra a
# imagem errada. `docker ps` dizia "healthy" e o app respondia certo em tudo o
# que ele de fato tinha. Nada no sistema podia contradizer o operador.
#
# A lista some daqui de proposito: ela mora em conteudo-carimbado.txt, um lugar
# so, para a soma da imagem e a soma do disco nunca divergirem por descuido.
# Somam-se os DIGESTS, nunca os caminhos.
RUN set -eu; \
    cd /app; \
    find $(grep -vE '^[[:space:]]*(#|$)' conteudo-carimbado.txt) -type f \
      | LC_ALL=C sort \
      | xargs sha256sum \
      | awk '{print $1}' \
      | sha256sum \
      | cut -c1-16 > /app/.versao-conteudo; \
    chown vanpro:vanpro /app/.versao-conteudo; \
    test -s /app/.versao-conteudo

# O filesystem sobe read-only no compose; uploads vao para volume montado aqui.
RUN mkdir -p /app/storage/uploads && chown -R vanpro:vanpro /app/storage

USER vanpro
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
