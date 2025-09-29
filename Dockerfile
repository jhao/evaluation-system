FROM python:3.11-slim

ARG DEBIAN_MIRROR=mirrors.aliyun.com
ARG PIP_INDEX=https://mirrors.aliyun.com/pypi/simple

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_INDEX_URL=${PIP_INDEX}

# 1) 把 deb 源换成国内镜像（同时替换 security 源）
RUN sed -i -e "s|deb.debian.org|${DEBIAN_MIRROR}|g" \
           -e "s|security.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list \
 && apt-get -o Acquire::Retries=3 update \
 && apt-get -y --no-install-recommends install build-essential gcc curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 2) 固化 pip 源（也可只用上面的 ENV）
RUN mkdir -p /etc/pip.conf.d \
 && printf "[global]\nindex-url = %s\n" "${PIP_INDEX}" > /etc/pip.conf

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libgfortran5 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend

WORKDIR /app/backend

RUN mkdir -p src/database src/static/uploads

EXPOSE 5001

ENV PYTHONPATH=/app/backend

CMD ["sh", "-c", "python src/main.py --pwd=${EVALUATION_ADMIN_PASSWORD:-tiandatiankai2025}"]
