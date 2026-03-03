# Use Bun official image
FROM oven/bun:1

WORKDIR /app

# Copy lock & package first (better cache)
COPY package.json bun.lockb* ./

# Install deps
RUN bun install --frozen-lockfile

# Copy rest of project
COPY . .

# Run database migrations (important)
RUN bun run migrate || true

# Start bot
CMD ["bun", "run", "start"]
