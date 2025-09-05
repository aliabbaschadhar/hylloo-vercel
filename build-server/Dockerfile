FROM oven/bun:alpine

WORKDIR /home/app

RUN apk add --no-cache git

COPY package.json ./
COPY kafka(ca).pem ./

RUN bun install

COPY . .

RUN chmod +x index.ts

ENTRYPOINT [ "bun","index.ts"]