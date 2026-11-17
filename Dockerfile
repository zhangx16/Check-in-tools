FROM node:24-bookworm-slim AS web
RUN apt-get update && apt-get install -y --no-install-recommends util-linux && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . /app
ENV HOST=0.0.0.0 PORT=22821 NODE_ENV=production
EXPOSE 22821
CMD ["node", "server.js"]

FROM python:3.13-slim-bookworm AS worker
WORKDIR /app
COPY --from=web /usr/local/bin/node /usr/local/bin/node
COPY --from=web /app /app
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 util-linux gcc libc6-dev \
 && python -m venv /app/.venv-embykeeper \
 && /app/.venv-embykeeper/bin/pip install --no-cache-dir -r requirements-telegram.txt \
 && apt-get purge -y gcc libc6-dev && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ENV HOST=0.0.0.0 PORT=22821 WORKBUDDY_PYTHON=/app/.venv-embykeeper/bin/python
EXPOSE 22821
CMD ["node", "server.js"]
