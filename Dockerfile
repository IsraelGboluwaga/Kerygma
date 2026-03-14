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

# ffmpeg is needed at runtime for MP3 → WAV conversion before transcription
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy compiled output and all native addons from builder.
# Both stages use Debian Bookworm (node:20 / node:20-slim) so glibc versions match
# and the compiled .node binaries and whisper.cpp binary are portable between stages.
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

ENV PORT=3000
ENV XENOVA_CACHE=/data/models

EXPOSE 3000

CMD ["node", "dist/main.js"]
