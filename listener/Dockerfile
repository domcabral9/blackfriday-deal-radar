FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY radar/ ./radar/

# Usuario sem privilegio; /sessions e /data sao volumes montados pelo compose
RUN useradd --uid 1000 --create-home radar \
    && mkdir -p /sessions /data \
    && chown radar:radar /sessions /data
USER radar

CMD ["python", "-m", "radar.listen"]
