FROM node:lts-alpine3.22 AS builder

# set workdir
WORKDIR /workspace/backend

# install build deps
COPY package*.json ./
RUN npm ci

# copy source and build the wishlist app (Nest monorepo)
COPY . .
RUN npm run build wishlist

FROM node:lts-alpine3.22 AS runner
WORKDIR /workspace/backend
ENV NODE_ENV=production

# copy built artifacts
COPY --from=builder /workspace/backend/dist ./dist

# copy package.json to install production deps only
COPY --from=builder /workspace/backend/package*.json ./
RUN npm ci --production

EXPOSE 3000
# start the wishlist app
CMD ["node", "dist/apps/wishlist/main.js"]
