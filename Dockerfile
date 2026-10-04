FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig*.json vite.config.ts index.html ./
COPY server ./server
COPY scripts ./scripts
COPY tests ./tests
COPY src ./src
COPY public ./public
COPY data ./data
RUN npm run build && npm test && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build-server ./build-server
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/data ./data
RUN mkdir -p /app/private && chown node:node /app/private && chmod 700 /app/private
USER node
EXPOSE 4173
CMD ["node", "build-server/server/index.js"]
