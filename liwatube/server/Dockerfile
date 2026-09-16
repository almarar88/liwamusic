# LiwaTube Server — صورة Docker خفيفة. البيانات (المقاطع + db.json) في /data
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts
COPY electron ./electron
COPY renderer ./renderer
COPY web ./web
COPY server ./server
COPY build ./build
ENV PORT=8787 LIWATUBE_DATA=/data NODE_ENV=production
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server/server.js"]
