ARG NODE_IMAGE=node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9

FROM ${NODE_IMAGE} AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        g++ \
        make \
        python3 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --chown=node:node . .

FROM ${NODE_IMAGE} AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="7Network CRM" \
    org.opencontainers.image.source="https://github.com/Ahammedsajal/SaleMax" \
    org.opencontainers.image.revision="${VCS_REF}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        libglib2.0-0 \
        libnspr4 \
        libnss3 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production FFMPEG_BIN=/usr/bin/ffmpeg
WORKDIR /app

COPY --from=build --chown=node:node /app /app

USER node
EXPOSE 3010
CMD ["node", "server.js"]
