# SwarmAI brain (NestJS + LangGraph). Multi-arch base image: builds on Apple Silicon and Oracle Ampere (arm64) or x86.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12.11.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# The TypeScript build needs more heap than Node's default (LangChain types are large)
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/packs ./packs
USER node
EXPOSE 4200
CMD ["node", "dist/main.js"]
