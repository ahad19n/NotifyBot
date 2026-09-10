FROM node:24-bookworm-slim
WORKDIR /usr/src/app

VOLUME /data

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 3000
CMD ["node", "src/server.js"]
