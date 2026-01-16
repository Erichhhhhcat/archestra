#!/bin/bash
#
# Deploy HTTP Sink Connectors to route Kafka events to Archestra A2A endpoints
#
# This script creates one Kafka Connect HTTP Sink connector per topic/agent.
#
# IMPORTANT NOTES:
# ================
# 1. Aiven HTTP Connector (Recommended, Open Source)
#    - Supports Mustache request body templating for A2A JSON-RPC format
#    - Not available on Confluent Hub - must be installed manually
#    - See: https://github.com/Aiven-Open/http-connector-for-apache-kafka
#
# 2. Confluent HTTP Sink Connector (Commercial)
#    - Does NOT support request body templating
#    - Sends raw Kafka message as HTTP body
#    - A2A endpoint expects JSON-RPC format, causing 400 errors
#    - Requires Confluent license for production use
#    - For testing only, consider using Python bridge instead
#
# For development/testing, use the Python bridge (docker compose up) which
# handles A2A format transformation correctly.
#
# Usage:
#   export ARCHESTRA_TOKEN=your-a2a-token
#   export CUSTOMER_SUPPORT_PROMPT_ID=xxx
#   export ORDER_PROCESSING_PROMPT_ID=xxx
#   export ANALYTICS_PROMPT_ID=xxx
#   ./scripts/deploy-connector.sh
#
# Or with .env file:
#   source .env && ./scripts/deploy-connector.sh

set -e

# Configuration
KAFKA_CONNECT_URL="${KAFKA_CONNECT_URL:-http://localhost:8083}"
ARCHESTRA_URL="${ARCHESTRA_URL:-http://host.docker.internal:9000}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Kafka Connect A2A Connector Deployment${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# Wait for Kafka Connect to be ready
echo -e "${YELLOW}Waiting for Kafka Connect to be ready...${NC}"
max_attempts=30
attempt=0
while ! curl -s "${KAFKA_CONNECT_URL}/connectors" > /dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ $attempt -ge $max_attempts ]; then
    echo -e "${RED}ERROR: Kafka Connect not ready after ${max_attempts} attempts${NC}"
    exit 1
  fi
  echo "  Attempt ${attempt}/${max_attempts}..."
  sleep 5
done
echo -e "${GREEN}Kafka Connect is ready!${NC}"
echo ""

# Check required environment variables
if [ -z "$ARCHESTRA_TOKEN" ]; then
  echo -e "${RED}ERROR: ARCHESTRA_TOKEN environment variable is required${NC}"
  echo "  Get this from: Archestra UI → Agents → [Agent] → A2A Connect → Expose token"
  exit 1
fi

# List installed plugins
echo -e "${BLUE}Installed Kafka Connect plugins:${NC}"
curl -s "${KAFKA_CONNECT_URL}/connector-plugins" | jq -r '.[].class' | sort | head -10
echo ""

# Check if Aiven HTTP connector is available
AIVEN_AVAILABLE=$(curl -s "${KAFKA_CONNECT_URL}/connector-plugins" | jq -r '.[].class' | grep -c "io.aiven" || true)
CONFLUENT_AVAILABLE=$(curl -s "${KAFKA_CONNECT_URL}/connector-plugins" | jq -r '.[].class' | grep -c "io.confluent.connect.http" || true)

if [ "$AIVEN_AVAILABLE" -gt 0 ]; then
  echo -e "${GREEN}Using Aiven HTTP Connector (open source)${NC}"
  CONNECTOR_CLASS="io.aiven.kafka.connect.http.HttpSinkConnector"
  USE_AIVEN=true
elif [ "$CONFLUENT_AVAILABLE" -gt 0 ]; then
  echo -e "${YELLOW}Using Confluent HTTP Connector (commercial)${NC}"
  CONNECTOR_CLASS="io.confluent.connect.http.HttpSinkConnector"
  USE_AIVEN=false
else
  echo -e "${RED}ERROR: No HTTP Sink connector found!${NC}"
  echo "  Install with: confluent-hub install aiven/aiven-kafka-connect-http:0.6.0"
  exit 1
fi
echo ""

# Function to deploy a connector with Aiven HTTP Sink
deploy_aiven_connector() {
  local name=$1
  local topic=$2
  local prompt_id=$3

  if [ -z "$prompt_id" ]; then
    echo -e "${YELLOW}Skipping ${name} - no prompt ID configured${NC}"
    return
  fi

  echo -e "${BLUE}Deploying connector: ${name}${NC}"
  echo "  Topic: ${topic}"
  echo "  Prompt ID: ${prompt_id}"
  echo "  URL: ${ARCHESTRA_URL}/v1/a2a/${prompt_id}"

  # Delete existing connector if it exists
  curl -s -X DELETE "${KAFKA_CONNECT_URL}/connectors/${name}" > /dev/null 2>&1 || true

  # A2A JSON-RPC request body template
  # Uses Mustache templating to wrap the Kafka message value
  # The {{value}} placeholder contains the original Kafka message
  local body_template='{"jsonrpc":"2.0","id":"{{topic}}-{{partition}}-{{offset}}","method":"message/send","params":{"message":{"parts":[{"kind":"text","text":"{{value}}"}]}}}'

  # Create connector with Aiven HTTP Sink
  local response
  response=$(curl -s -X POST "${KAFKA_CONNECT_URL}/connectors" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "'"${name}"'",
      "config": {
        "connector.class": "io.aiven.kafka.connect.http.HttpSinkConnector",
        "tasks.max": "1",
        "topics": "'"${topic}"'",

        "http.url": "'"${ARCHESTRA_URL}"'/v1/a2a/'"${prompt_id}"'",
        "http.authorization.type": "static",
        "http.headers.authorization": "Bearer '"${ARCHESTRA_TOKEN}"'",
        "http.headers.content.type": "application/json",

        "batching.enabled": "false",
        "http.request.body.template": "'"${body_template}"'",

        "retry.backoff.ms": "1000",
        "max.retries": "3",

        "key.converter": "org.apache.kafka.connect.storage.StringConverter",
        "value.converter": "org.apache.kafka.connect.storage.StringConverter"
      }
    }')

  # Check for errors
  if echo "$response" | jq -e '.error_code' > /dev/null 2>&1; then
    echo -e "${RED}  ERROR: $(echo "$response" | jq -r '.message')${NC}"
    return 1
  else
    echo -e "${GREEN}  Connector created successfully${NC}"
  fi
  echo ""
}

# Function to deploy a connector with Confluent HTTP Sink
deploy_confluent_connector() {
  local name=$1
  local topic=$2
  local prompt_id=$3

  if [ -z "$prompt_id" ]; then
    echo -e "${YELLOW}Skipping ${name} - no prompt ID configured${NC}"
    return
  fi

  echo -e "${BLUE}Deploying connector: ${name}${NC}"
  echo "  Topic: ${topic}"
  echo "  Prompt ID: ${prompt_id}"
  echo "  URL: ${ARCHESTRA_URL}/v1/a2a/${prompt_id}"

  # Delete existing connector if it exists
  curl -s -X DELETE "${KAFKA_CONNECT_URL}/connectors/${name}" > /dev/null 2>&1 || true

  # Create connector with Confluent HTTP Sink
  # Uses InsertField SMT to add A2A JSON-RPC wrapper fields
  local response
  response=$(curl -s -X POST "${KAFKA_CONNECT_URL}/connectors" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "'"${name}"'",
      "config": {
        "connector.class": "io.confluent.connect.http.HttpSinkConnector",
        "tasks.max": "1",
        "topics": "'"${topic}"'",

        "http.api.url": "'"${ARCHESTRA_URL}"'/v1/a2a/'"${prompt_id}"'",
        "headers": "Content-Type:application/json|Authorization:Bearer '"${ARCHESTRA_TOKEN}"'",
        "request.method": "POST",

        "batch.max.size": "1",
        "retry.on.status.codes": "408,429,500,502,503,504",
        "max.retries": "3",
        "retry.backoff.ms": "1000",
        "behavior.on.error": "log",

        "confluent.topic.bootstrap.servers": "kafka:29092",
        "reporter.bootstrap.servers": "kafka:29092",
        "reporter.result.topic.name": "archestra-responses",
        "reporter.error.topic.name": "archestra-errors",

        "key.converter": "org.apache.kafka.connect.storage.StringConverter",
        "value.converter": "org.apache.kafka.connect.storage.StringConverter",

        "transforms": "wrapA2A",
        "transforms.wrapA2A.type": "org.apache.kafka.connect.transforms.HoistField$Value",
        "transforms.wrapA2A.field": "text"
      }
    }')

  # Check for errors
  if echo "$response" | jq -e '.error_code' > /dev/null 2>&1; then
    echo -e "${RED}  ERROR: $(echo "$response" | jq -r '.message')${NC}"
    return 1
  else
    echo -e "${GREEN}  Connector created successfully${NC}"
    echo -e "${YELLOW}  Note: Confluent connector uses basic SMT; A2A format may need adjustment${NC}"
  fi
  echo ""
}

# Deploy function selector
deploy_connector() {
  if [ "$USE_AIVEN" = true ]; then
    deploy_aiven_connector "$@"
  else
    deploy_confluent_connector "$@"
  fi
}

# ============================================
# Deploy connectors for each topic/agent
# ============================================

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Deploying HTTP Sink Connectors${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

deploy_connector "archestra-customer-support" "customer.events" "$CUSTOMER_SUPPORT_PROMPT_ID"
deploy_connector "archestra-order-processing" "orders.events" "$ORDER_PROCESSING_PROMPT_ID"
deploy_connector "archestra-analytics" "analytics.events" "$ANALYTICS_PROMPT_ID"

# ============================================
# Show connector status
# ============================================

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}Connector Status${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

connectors=$(curl -s "${KAFKA_CONNECT_URL}/connectors")
echo "Active connectors: $(echo "$connectors" | jq -r '. | length')"
echo ""

for connector in $(echo "$connectors" | jq -r '.[]'); do
  status=$(curl -s "${KAFKA_CONNECT_URL}/connectors/${connector}/status")
  state=$(echo "$status" | jq -r '.connector.state')

  if [ "$state" = "RUNNING" ]; then
    echo -e "  ${GREEN}✓${NC} ${connector}: ${state}"
  else
    echo -e "  ${RED}✗${NC} ${connector}: ${state}"
  fi
done

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${GREEN}Deployment complete!${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo "Check connector status:"
echo "  curl ${KAFKA_CONNECT_URL}/connectors/<name>/status"
echo ""
echo "View connector logs:"
echo "  docker logs archestra-kafka-connect"
echo ""
echo "Test with a message:"
echo "  echo '{\"customer_id\": \"123\", \"message\": \"Hello\"}' | \\"
echo "    docker exec -i archestra-kafka-native kafka-console-producer \\"
echo "      --topic customer.events --bootstrap-server localhost:9092"
