# Multi-stage build for Last Call
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev=false

FROM deps AS build
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy production artifacts only.
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist          ./dist
COPY package.json tsconfig.json tsconfig.server.json ./
COPY server ./server
COPY shared ./shared

# Render injects PORT; the app reads it. Expose a sensible default for `docker run`.
ENV PORT=3001
EXPOSE 3001

CMD ["npm", "start"]
