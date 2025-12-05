# Utilise l'image officielle Bun
FROM oven/bun:1

WORKDIR /app

# Copier les fichiers de config
COPY package.json ./
COPY bun.lockb* ./

# Installer les dépendances (nodes7)
RUN bun install --production

# Copier le code
COPY backend ./backend
COPY frontend ./frontend

# Variables d'environnement
ENV NODE_ENV=production
ENV PLC_IP=192.168.0.1

# Exposer le port
EXPOSE 3000

# Lancer
CMD ["bun", "backend/server.ts"]