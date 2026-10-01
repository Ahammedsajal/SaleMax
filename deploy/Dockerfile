FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates ffmpeg libglib2.0-0 libnss3 libnspr4 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production FFMPEG_BIN=/usr/bin/ffmpeg
WORKDIR /app
COPY package.json package-lock.json ./
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node . .
USER node
EXPOSE 3010
CMD ["node", "server.js"]

