# syntax=docker/dockerfile:1
# Optional deployment. The normal installation does not need Docker.
FROM python:3.13-slim AS docs
# Documentation (MkDocs Material) is built here so the final image can serve it at /docs/.
WORKDIR /w
COPY requirements-docs.txt ./
RUN pip install --no-cache-dir -r requirements-docs.txt
COPY mkdocs.yml ./
COPY docs ./docs
RUN NO_MKDOCS_2_WARNING=true mkdocs build --strict

FROM node:24-alpine AS build
# Optional: commit id shown in Settings > About (the image has no .git). docker compose build --build-arg OPSDESK_COMMIT=<sha>
ARG OPSDESK_COMMIT=""
ENV OPSDESK_COMMIT=$OPSDESK_COMMIT
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts ./
COPY scripts ./scripts
COPY shared ./shared
COPY server ./server
COPY web ./web
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production \
    OPSDESK_HOST=0.0.0.0 \
    OPSDESK_ALLOW_NETWORK=1 \
    OPSDESK_PORT=4310 \
    OPSDESK_DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=docs /w/dist/docs ./dist/docs
COPY scripts ./scripts
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.OPSDESK_PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/index.js"]
