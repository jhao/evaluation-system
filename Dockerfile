FROM python:3.11-slim

ARG DEBIAN_MIRROR=mirrors.aliyun.com
ARG DEBIAN_MIRROR_SCHEME=https
ARG PIP_INDEX=https://mirrors.aliyun.com/pypi/simple

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_INDEX_URL=${PIP_INDEX}

# 1) 尝试使用国内镜像，如果失败则回退到官方源
RUN set -eux; \
    cp /etc/apt/sources.list /tmp/sources.list.default; \
    . /etc/os-release; \
    MIRROR_HOST="${DEBIAN_MIRROR}"; \
    MIRROR_SCHEME="${DEBIAN_MIRROR_SCHEME}"; \
    if [ -n "${MIRROR_HOST}" ]; then \
        cat <<'EOF' > /etc/apt/sources.list
deb ${MIRROR_SCHEME}://${MIRROR_HOST}/debian ${VERSION_CODENAME} main
deb ${MIRROR_SCHEME}://${MIRROR_HOST}/debian ${VERSION_CODENAME}-updates main
deb ${MIRROR_SCHEME}://${MIRROR_HOST}/debian ${VERSION_CODENAME}-backports main
deb ${MIRROR_SCHEME}://${MIRROR_HOST}/debian-security ${VERSION_CODENAME}-security main
EOF
    fi; \
    if ! apt-get -o Acquire::Retries=3 update; then \
        echo "Mirror ${MIRROR_HOST} unavailable, falling back to default Debian sources"; \
        cp /tmp/sources.list.default /etc/apt/sources.list; \
        apt-get -o Acquire::Retries=3 update; \
    fi; \
    rm -f /tmp/sources.list.default; \
    apt-get -y --no-install-recommends install build-essential curl ca-certificates libgfortran5 libgomp1; \
    rm -rf /var/lib/apt/lists/*

# 2) 固化 pip 源（也可只用上面的 ENV）
RUN mkdir -p /etc/pip.conf.d \
 && printf "[global]\nindex-url = %s\n" "${PIP_INDEX}" > /etc/pip.conf

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt

RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend

WORKDIR /app/backend

RUN mkdir -p src/database src/static/uploads

EXPOSE 5001

ENV PYTHONPATH=/app/backend

CMD ["sh", "-c", "python src/main.py --pwd=${EVALUATION_ADMIN_PASSWORD:-tiandatiankai2025}"]
