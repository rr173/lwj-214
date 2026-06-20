FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npm run build

RUN npm prune --production

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed.js && npm start"]
