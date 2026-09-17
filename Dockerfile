# LiwaTube Server — صورة جاهزة للنشر بنقرة واحدة (Railway / Render / أي مضيف Docker).
# البيانات (المقاطع + db.json) في /data — اربط بها قرصًا/حجمًا دائمًا.
FROM node:22-alpine
WORKDIR /app
COPY liwatube/package.json liwatube/package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts
COPY liwatube/electron ./electron
COPY liwatube/renderer ./renderer
COPY liwatube/web ./web
COPY liwatube/server ./server
COPY liwatube/build ./build
ENV PORT=8787 LIWATUBE_DATA=/data NODE_ENV=production
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT:-8787}/api/site >/dev/null || exit 1
CMD ["node", "server/server.js"]
