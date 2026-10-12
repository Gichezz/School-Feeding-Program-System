# Lishe API (Express). Configuration comes from environment variables; see .env.example.
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies first so this layer is cached between code changes
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

USER node
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:5000/api/health || exit 1

CMD ["node", "src/server.js"]
