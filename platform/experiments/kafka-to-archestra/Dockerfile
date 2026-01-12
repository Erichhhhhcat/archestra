# Kafka to Archestra Bridge Service
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for confluent-kafka
RUN apt-get update && apt-get install -y --no-install-recommends \
    librdkafka-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/
COPY config/ ./config/

# Set environment defaults
ENV PYTHONUNBUFFERED=1
ENV LOG_LEVEL=INFO

# Run the bridge service
CMD ["python", "-m", "src.kafka_bridge"]
