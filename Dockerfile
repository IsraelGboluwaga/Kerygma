# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20 AS builder

# Tools needed to compile whisper.cpp (cmake + C++ toolchain) and better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    build-essential \
    python3 \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first — compiles native addons (better-sqlite3)
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Explicitly compile whisper.cpp — postinstall alone isn't reliable in Docker
RUN cd node_modules/nodejs-whisper/cpp/whisper.cpp && \
    cmake -B build \
          -DCMAKE_BUILD_TYPE=Release \
          -DGGML_CUDA=OFF \
          -DGGML_METAL=OFF \
          -DGGML_NATIVE=OFF \
    && cmake --build build -j2

# Download whisper model into the package's models directory
# Override at build time with: docker build --build-arg WHISPER_MODEL=medium.en
ARG WHISPER_MODEL=medium.en
RUN wget -O node_modules/nodejs-whisper/cpp/whisper.cpp/models/ggml-${WHISPER_MODEL}.bin \
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin" \
    && test $(stat -c%s node_modules/nodejs-whisper/cpp/whisper.cpp/models/ggml-${WHISPER_MODEL}.bin) -gt 50000000 \
    || (echo "ERROR: model download incomplete — check URL or network" && exit 1)

# Compile TypeScript
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=4096 yarn build


# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# ffmpeg: MP3 → WAV conversion at runtime
# libstdc++6 + libgomp1: C++ stdlib and OpenMP runtime linked by better-sqlite3
#   and whisper.cpp — present in node:20 but stripped from node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libstdc++6 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

ENV PORT=3000
ENV DB_PATH=/app/data/sermons.db
ENV XENOVA_CACHE=/app/data/models

EXPOSE 3000

CMD ["node", "dist/main.js"]
