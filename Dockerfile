FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run setup:worker && npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["npm", "start"]
