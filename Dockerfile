# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20 AS builder

# build-essential + python3: compile better-sqlite3 native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy both the root and frontend manifests so the yarn workspace install
# resolves backend + frontend deps in one cached layer.
COPY package.json yarn.lock ./
COPY frontend/package.json ./frontend/package.json
RUN yarn install --frozen-lockfile

COPY . .
# Builds the React SPA (→ public/app) and the backend (→ dist).
RUN yarn build


# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# ffmpeg: re-encodes audio files > 25 MB before Whisper API upload
# libstdc++6 + libgomp1: C++ runtime required by better-sqlite3
#   (present in node:20 but stripped from node:20-slim)
# ca-certificates: required for curl SSL verification (stripped from node:20-slim)
# curl: used to download the Litestream binary below
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libstdc++6 \
    libgomp1 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Litestream for continuous SQLite replication to R2
RUN curl -fsSL https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz \
    | tar -xz -C /usr/local/bin litestream

WORKDIR /app

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public       ./public

COPY litestream.yml         ./litestream.yml
COPY docker-entrypoint.sh   ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

ENV PORT=3000
ENV DB_PATH=/app/data/sermons.db
ENV XENOVA_CACHE=/app/data/models

EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
