# The oracle and challenge service, as a container.
#
# It runs on a VPS whose Caddy is shared ingress for several products, and the
# way in is by container name on that Caddy's network. So this image exists to
# give the service a stable name to be reached at, nothing more. The client
# half is static and goes to Vercel; none of it is in here.
#
# Node 22 because package.json asks for >=20.19 and the host's own Node is
# 18.19, which is exactly the kind of mismatch a container is for.
FROM node:22-alpine

WORKDIR /app

# Dependencies first, so a source edit does not reinstall the world. tsx is a
# runtime dependency rather than a dev one, which is what makes --omit=dev
# safe here: the service is run through it rather than compiled ahead of time.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The server now imports the level builder from src/, so it can rebuild a level
# from its seed and check a claimed score against what that level actually
# contains. See server/verify.ts. The client half still never runs here; these
# are pure simulation modules with no DOM in them, which is enforced by the
# server tsconfig having no DOM lib.
COPY tsconfig.server.json ./
COPY server ./server
COPY shared ./shared
COPY src ./src

# The snapshot lives on a volume. Without this it lands in the working
# directory and every redeploy silently starts the leaderboard from nothing.
ENV NODE_ENV=production \
    PORT=8790 \
    DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 8790

# No shell form: with exec form the process is PID 1 and gets SIGTERM directly,
# so a restart is a clean shutdown rather than a ten second kill.
CMD ["npx", "tsx", "server/start.ts"]
