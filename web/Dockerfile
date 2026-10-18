# SwarmAI web (Next.js PWA). NEXT_PUBLIC_API_URL is inlined at build time — rebuild the image when it changes.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12.11.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN [ -n "$NEXT_PUBLIC_API_URL" ] || { echo "build arg NEXT_PUBLIC_API_URL is required (https://<your-domain>)"; exit 1; } \
 && pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
USER node
EXPOSE 3200
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3200"]
