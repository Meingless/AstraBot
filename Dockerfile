# Astra Discord Suite — Production Docker image
# Uses Node.js 22+ because the project relies on the built-in node:sqlite module.

# --- Build stage ---
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first so Docker can cache the layer.
COPY package*.json ./
RUN npm ci

# Copy source and build both the server and the Vite dashboard.
COPY . .
RUN npm run build
RUN npm run verify:build

# --- Runtime stage ---
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the built artifacts from the builder stage.
COPY --from=builder /app/dist ./dist

# Persist SQLite database outside the container.
RUN mkdir -p /app/data /app/backups \
    && chown node:node /app/data /app/backups \
    && chmod 700 /app/data /app/backups
VOLUME ["/app/data"]

EXPOSE 3000

USER node
STOPSIGNAL SIGTERM
CMD ["node", "dist/server/index.js"]
