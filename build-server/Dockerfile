FROM ubuntu:focal

RUN apt-get update && apt-get install -y curl
RUN curl -sL https://bun.sh/install | bash
RUN apt-get upgrade -y
RUN apt-get install -y git

WORKDIR /home/app
COPY ./main.sh ./

ENTRYPOINT [ "bash", "main.sh" ]  