FROM node:lts-alpine3.22

# Install build dependencies
RUN apk add --no-cache \
    git \
    openssl

# Install NestJS CLI globally
RUN npm install -g @nestjs/cli

WORKDIR /workspace/backend

# Default shell
CMD ["tail", "-f", "/dev/null"]