FROM node:20-alpine

WORKDIR /app

# Copy shared packages first (these are local deps)
COPY packages/shared-types/ packages/shared-types/
COPY packages/shared-policy/ packages/shared-policy/

# Copy API package.json and install deps
COPY apps/api/package.json apps/api/
WORKDIR /app/apps/api
RUN npm install --legacy-peer-deps

# Copy API source (after install so node_modules is preserved)
COPY apps/api/src/ src/
COPY apps/api/tsconfig.json .
COPY apps/api/jest.config.js .
COPY apps/api/tests/ tests/

# Create uploads directory
RUN mkdir -p uploads

# Entrypoint sources .env at runtime if available
COPY docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN chmod +x /usr/local/bin/api-entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["api-entrypoint.sh"]
CMD ["npx", "tsx", "src/server.ts"]
