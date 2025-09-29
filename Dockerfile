FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libgfortran5 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir -r backend/requirements.txt
    
COPY backend ./backend

WORKDIR /app/backend

RUN mkdir -p src/database src/static/uploads

EXPOSE 5001

ENV PYTHONPATH=/app/backend

CMD ["sh", "-c", "python src/main.py --pwd=${EVALUATION_ADMIN_PASSWORD:-tiandatiankai2025}"]
