# syntax=docker/dockerfile:1

# --- build -----------------------------------------------------------------
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

# npm fixado: build reproduzivel nao pode depender de qual npm a imagem base
# trouxe hoje. Ver o comentario equivalente em `api/Dockerfile`.
RUN npm install -g npm@11.6.2

# `npm ci` e nao `npm install`: em CI/Docker o lockfile e a verdade. `install`
# resolveria versoes novas em silencio — a porta de entrada de dependencia
# comprometida.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- runtime ---------------------------------------------------------------
# `nginx:alpine` nao tinha versao nenhuma: a tag flutua entre minors e um
# `docker build` de amanha podia trocar o servidor por baixo do produto.
FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS runner

# Portas 8080/8443 e nao 80/443: abaixo de 1024 exige privilegio, e este
# container roda como usuario comum. A 8080 so redireciona; a app vive na 8443.
COPY nginx.conf /etc/nginx/nginx.conf
COPY seguranca.conf /etc/nginx/vanpro-seguranca.conf
COPY --from=builder /app/dist /usr/share/nginx/html

# Diretorios de escrita do nginx pertencem ao usuario nao-root; sem isso o
# processo sobe e morre no primeiro cache de proxy.
RUN rm -f /etc/nginx/conf.d/default.conf \
  && mkdir -p /var/cache/nginx /var/run \
  && chown -R nginx:nginx /var/cache/nginx /var/run /usr/share/nginx/html

USER nginx

EXPOSE 8080 8443

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
