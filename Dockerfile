FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY public ./public
COPY src ./src
COPY data_new ./data_new
COPY server.js ./server.js

RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "start"]
