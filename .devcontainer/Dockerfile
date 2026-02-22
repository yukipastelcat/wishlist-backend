FROM node:lts-alpine3.22

# Install build dependencies
RUN apk add --no-cache \
    git \
    openssl

RUN mkdir -p /etc/wishlist/keys /etc/wishlist/certs \
    && if [ ! -f /etc/wishlist/keys/private.pem ] || [ ! -f /etc/wishlist/certs/public.pem ]; then \
      openssl genrsa -out /etc/wishlist/keys/private.pem 4096 \
      && openssl rsa -in /etc/wishlist/keys/private.pem -pubout -out /etc/wishlist/certs/public.pem; \
    fi

# Install NestJS CLI globally
RUN npm install -g @nestjs/cli

WORKDIR /workspace/backend

# Default shell
CMD ["tail", "-f", "/dev/null"]
