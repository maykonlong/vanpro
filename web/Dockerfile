# syntax=docker/dockerfile:1

# --- build -----------------------------------------------------------------
FROM node:22-alpine AS builder

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
FROM nginx:alpine AS runner

# Porta 8080 e nao 80: abaixo de 1024 exige privilegio, e este container roda
# como usuario comum.
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /app/dist /usr/share/nginx/html

# Diretorios de escrita do nginx pertencem ao usuario nao-root; sem isso o
# processo sobe e morre no primeiro cache de proxy.
RUN rm -f /etc/nginx/conf.d/default.conf \
  && mkdir -p /var/cache/nginx /var/run \
  && chown -R nginx:nginx /var/cache/nginx /var/run /usr/share/nginx/html

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
