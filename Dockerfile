# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20 AS builder

# build-essential + python3: compile better-sqlite3 native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN NODE_OPTIONS=--max-old-space-size=4096 yarn build


# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# ffmpeg: re-encodes audio files > 25 MB before Whisper API upload
# libstdc++6 + libgomp1: C++ runtime required by better-sqlite3
#   (present in node:20 but stripped from node:20-slim)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libstdc++6 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public       ./public

ENV PORT=3000
ENV DB_PATH=/app/data/sermons.db
ENV XENOVA_CACHE=/app/data/models

EXPOSE 3000

CMD ["node", "dist/main.js"]
