FROM python:3.13-slim

# Create non-root user
RUN addgroup --gid 1000 appgroup \
    && adduser  --uid 1000 --gid 1000 --system --home /app appuser

# System dependencies
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Copy project
COPY ./app/ .

# Set permissions
RUN chown -R appuser:appgroup /app

# Set UV cache directory and home
ENV UV_CACHE_DIR=/tmp/uv
ENV HOME=/app

# Switch to non-root user
USER appuser

EXPOSE 8000

COPY Docker/entrypoint.app.sh /entrypoint.app.sh
COPY Docker/entrypoint.worker-arq.sh /entrypoint.worker-arq.sh
COPY Docker/entrypoint.worker-monitor.sh /entrypoint.worker-monitor.sh