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

# Install dependencies first — compiles native addons (better-sqlite3, whisper.cpp)
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Download whisper model into the package's models directory
# Override at build time with: docker build --build-arg WHISPER_MODEL=small.en
ARG WHISPER_MODEL=base.en
RUN wget -q -O node_modules/nodejs-whisper/cpp/whisper.cpp/models/ggml-${WHISPER_MODEL}.bin \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin"

# Compile TypeScript
COPY . .
RUN yarn build


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

EXPOSE 3000

CMD ["node", "dist/main.js"]
