FROM node:20-alpine

WORKDIR /app

# Copy shared packages first (these are local deps)
COPY packages/shared-types/ packages/shared-types/
COPY packages/shared-policy/ packages/shared-policy/

# Copy web package.json and install deps
COPY apps/web/package.json apps/web/
WORKDIR /app/apps/web
RUN npm install --legacy-peer-deps

# Copy web source (after install so node_modules is preserved)
COPY apps/web/src/ src/
COPY apps/web/index.html .
COPY apps/web/tsconfig.json .
COPY apps/web/vite.config.ts .
COPY apps/web/vitest.config.ts .
COPY apps/web/tests/ tests/

EXPOSE 3000

CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "3000"]
