# Astra Discord Suite — Production Docker image
# Uses Node.js 22+ because the project relies on the built-in node:sqlite module.

# --- Build stage ---
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS builder

WORKDIR /app

# Install dependencies first so Docker can cache the layer.
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and build both the server and the Vite dashboard.
COPY . .
RUN npm run build
RUN npm run verify:build

# --- Runtime stage ---
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
      /opt/yarn-v1.22.22 \
      /root/.npm \
      /home/node/.npm

# Copy the built artifacts from the builder stage.
COPY --chown=node:node --from=builder /app/dist ./dist

# Persist SQLite database outside the container.
RUN mkdir -p /app/data /app/backups \
    && chown node:node /app/data /app/backups \
    && chmod 700 /app/data /app/backups
VOLUME ["/app/data", "/app/backups"]

EXPOSE 3000

USER node
STOPSIGNAL SIGTERM
CMD ["node", "dist/server/index.js"]
