FROM node:lts-alpine3.22

# Install build dependencies
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    gcc

# Install NestJS CLI globally
RUN npm install -g @nestjs/cli

# Set working directory
WORKDIR /workspace/backend

# Keep container running
CMD ["tail", "-f", "/dev/null"]
