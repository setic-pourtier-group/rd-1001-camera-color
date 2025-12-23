FROM oven/bun:1

WORKDIR /app

# Installer FFmpeg pour la capture vidéo
RUN apt-get update && apt-get install -y ffmpeg

# Copier les fichiers de dépendances
COPY package.json ./
COPY bun.lockb* ./

# Installer les dépendances JS (nodes7)
RUN bun install --production

# Copier tout le code
COPY backend ./backend
COPY frontend ./frontend

# Configuration
ENV NODE_ENV=production
ENV PLC_IP=192.168.0.1

EXPOSE 3000

CMD ["bun", "backend/server.ts"]