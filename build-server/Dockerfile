FROM ubuntu:focal

RUN apt-get update && apt-get install -y curl unzip
RUN curl -sL https://bun.sh/install | bash
RUN apt-get upgrade -y
RUN apt-get install -y git

ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /home/app
COPY ./main.sh ./

COPY package.json bun.lock ./

RUN bun install

COPY . . 

RUN chmod +x main.sh
RUN chmod +x index.ts

ENTRYPOINT [ "/home/app/main.sh"]