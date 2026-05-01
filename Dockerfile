FROM node:22-bookworm-slim AS web-build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm install
COPY apps/web apps/web
RUN npm --workspace @melodify/web run build

FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=4000

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY apps/api/requirements.txt apps/api/requirements.txt
RUN pip install --no-cache-dir -r apps/api/requirements.txt

COPY apps/api apps/api
COPY --from=web-build /app/apps/web/dist apps/web/dist
COPY .env.example .env.example

EXPOSE 4000

WORKDIR /app/apps/api

CMD ["python", "-m", "app.scripts.run_server"]
