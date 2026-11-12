FROM node:22-alpine

LABEL org.opencontainers.image.title="pupboard" \
      org.opencontainers.image.description="Animated, glanceable stats homepage: Steam, Navidrome, Jellyfin and RSS" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8742 \
    DATA_DIR=/app/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY LICENSE ./

RUN mkdir -p /app/data /app/config && chown -R node:node /app/data
USER node

EXPOSE 8742
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8742/api/health || exit 1

CMD ["node", "server/index.js"]
