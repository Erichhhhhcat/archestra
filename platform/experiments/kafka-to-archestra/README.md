# Kafka to Archestra Integration

This example demonstrates how to consume events from Apache Kafka and route them to Archestra agents via the A2A (Agent-to-Agent) protocol.

## Overview

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────────────────┐
│  Event Sources  │     │   Kafka Cluster     │     │     Archestra Platform      │
│                 │     │                     │     │                             │
│ • Applications  │────▶│ • customer.events   │     │  ┌─────────────────────┐   │
│ • Microservices │     │ • orders.events     │────▶│  │  Customer Support   │   │
│ • IoT Devices   │     │ • analytics.events  │     │  │       Agent         │   │
│ • Webhooks      │     │                     │     │  └─────────────────────┘   │
└─────────────────┘     └─────────────────────┘     │                             │
                                  │                 │  ┌─────────────────────┐   │
                                  │                 │  │   Order Processing  │   │
                        ┌─────────▼─────────┐       │  │       Agent         │   │
                        │                   │       │  └─────────────────────┘   │
                        │   Kafka Bridge    │──────▶│                             │
                        │     Service       │       │  ┌─────────────────────┐   │
                        │                   │       │  │  Analytics Insights │   │
                        └───────────────────┘       │  │       Agent         │   │
                                                    │  └─────────────────────┘   │
                                                    └─────────────────────────────┘
```

The **Kafka Bridge Service** consumes messages from Kafka topics and routes them to different Archestra agents based on configurable rules. This enables:

- **Event-driven AI workflows**: Trigger AI agents automatically from business events
- **Scalable message processing**: Leverage Kafka's reliability and Archestra's AI capabilities
- **Flexible routing**: Route different event types to specialized AI agents

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- An Archestra instance (local or remote)
- Access to create Agents/Profiles in Archestra

### Step 1: Start Archestra Platform

If you don't have Archestra running, start it with Docker:

```bash
docker pull archestra/platform:latest
docker run -d \
  --name archestra \
  -p 9000:9000 \
  -p 3000:3000 \
  -v archestra-postgres-data:/var/lib/postgresql/data \
  -v archestra-app-data:/app/data \
  archestra/platform:latest
```

Access the UI at http://localhost:3000 and complete the initial setup.

### Step 2: Create 3 Agents in Archestra

Log in to Archestra (http://localhost:3000) and create three agents (profiles):

#### Agent 1: Customer Support Agent

1. Go to **Profiles** → **Create Profile**
2. Configure:
   - **Name**: `Customer Support Agent`
   - **Description**: `Handles customer support inquiries and issues`
3. After creating, go to the **Prompts** tab and create a new prompt:
   - **Name**: `Customer Support Handler`
   - **System Prompt**:
     ```
     You are a helpful customer support agent. Analyze customer inquiries and provide:
     1. A summary of the issue
     2. Suggested resolution steps
     3. Priority classification (low/medium/high/critical)
     4. Any escalation recommendations
     
     Be professional, empathetic, and solution-oriented.
     ```
   - **User Prompt**: `{message}` (this will be replaced by the Kafka message)
4. **Copy the Prompt ID** from the URL or prompt details (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)

#### Agent 2: Order Processing Agent

1. Go to **Profiles** → **Create Profile**
2. Configure:
   - **Name**: `Order Processing Agent`
   - **Description**: `Processes and analyzes order events`
3. Create a prompt:
   - **Name**: `Order Event Processor`
   - **System Prompt**:
     ```
     You are an order processing assistant. When receiving order events, analyze them and provide:
     1. Order status summary
     2. Any anomalies or issues detected
     3. Recommended actions
     4. Inventory or fulfillment considerations
     
     Focus on operational efficiency and customer satisfaction.
     ```
   - **User Prompt**: `{message}`
4. **Copy the Prompt ID**

#### Agent 3: Analytics Insights Agent

1. Go to **Profiles** → **Create Profile**
2. Configure:
   - **Name**: `Analytics Insights Agent`
   - **Description**: `Provides insights from analytics data`
3. Create a prompt:
   - **Name**: `Analytics Analyzer`
   - **System Prompt**:
     ```
     You are a data analytics expert. When receiving metrics and analytics data:
     1. Interpret the data meaningfully
     2. Identify trends or anomalies
     3. Provide actionable insights
     4. Suggest areas for improvement
     
     Be data-driven and focus on business impact.
     ```
   - **User Prompt**: `{message}`
4. **Copy the Prompt ID**

### Step 3: Get an API Token

1. Go to **Settings** → **Your Account** → **Personal Tokens**
2. Create a new token with appropriate permissions
3. Copy the token value

### Step 4: Configure Environment

```bash
cd platform/experiments/kafka-to-archestra

# Copy and edit the environment file
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Archestra Configuration
ARCHESTRA_URL=http://host.docker.internal:9000
ARCHESTRA_TOKEN=your-token-from-step-3

# Prompt IDs from the agents you created
CUSTOMER_SUPPORT_PROMPT_ID=<prompt-id-from-agent-1>
ORDER_PROCESSING_PROMPT_ID=<prompt-id-from-agent-2>
ANALYTICS_PROMPT_ID=<prompt-id-from-agent-3>
```

### Step 5: Start the Kafka Stack

```bash
# Start Kafka, Zookeeper, and the Bridge service
docker-compose up -d

# View logs
docker-compose logs -f kafka-bridge
```

### Step 6: Send Test Messages

Using Python script:

```bash
# Install dependencies
pip install confluent-kafka

# Send test messages
python scripts/send_test_messages.py
```

Or using the shell script:

```bash
./scripts/send_test_messages.sh
```

Or manually with kafka-console-producer:

```bash
# Customer support message
echo '{"customer_id":"CUST-001","issue_type":"billing","priority":"high","message":"Double charged for subscription"}' | \
  docker-compose exec -T kafka kafka-console-producer \
    --bootstrap-server kafka:29092 \
    --topic customer.events

# Order event
echo '{"order_id":"ORD-123","event_type":"shipped","customer_email":"user@example.com","details":"{}"}' | \
  docker-compose exec -T kafka kafka-console-producer \
    --bootstrap-server kafka:29092 \
    --topic orders.events

# Analytics event
echo '{"metric_name":"conversion_rate","value":3.5,"timestamp":"2025-01-12T10:00:00Z","dimensions":"{}"}' | \
  docker-compose exec -T kafka kafka-console-producer \
    --bootstrap-server kafka:29092 \
    --topic analytics.events
```

### Step 7: View Results

Watch the bridge logs to see messages being processed:

```bash
docker-compose logs -f kafka-bridge
```

You should see output like:

```
INFO - Routing message from topic 'customer.events' to agent via prompt 'abc123...' (route: customer-support)
INFO - Agent response: ## Issue Summary
The customer reports being double charged for their subscription...
```

## Configuration

### Routes Configuration

The bridge uses a routing configuration to determine which Kafka messages go to which Archestra agent. Edit `config/routes.json`:

```json
[
  {
    "name": "customer-support",
    "topic_pattern": "customer.events",
    "prompt_id": "your-customer-support-prompt-id",
    "header_match": null,
    "field_match": null,
    "transform_template": "New customer support request:\n\nCustomer ID: {customer_id}\nIssue: {message}"
  },
  {
    "name": "order-processing",
    "topic_pattern": "orders.*",
    "prompt_id": "your-order-processing-prompt-id",
    "transform_template": "Order Event:\nOrder ID: {order_id}\nEvent: {event_type}"
  },
  {
    "name": "analytics",
    "topic_pattern": "analytics.events",
    "prompt_id": "your-analytics-prompt-id"
  }
]
```

### Route Options

| Field | Description |
|-------|-------------|
| `name` | Human-readable route name |
| `topic_pattern` | Kafka topic name or wildcard pattern (e.g., `orders.*`) |
| `prompt_id` | Archestra prompt ID to route messages to |
| `header_match` | Optional: Match Kafka headers `{"key": "value"}` |
| `field_match` | Optional: Match JSON message fields `{"type": "order"}` |
| `transform_template` | Optional: Transform message using `{field}` placeholders |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ARCHESTRA_URL` | Archestra API URL | `http://localhost:9000` |
| `ARCHESTRA_TOKEN` | Archestra API token | (required) |
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka bootstrap servers | `localhost:9092` |
| `KAFKA_GROUP_ID` | Consumer group ID | `archestra-bridge` |
| `KAFKA_TOPICS` | Topics to consume | `customer.events,orders.events,analytics.events` |
| `LOG_LEVEL` | Logging level | `INFO` |
| `MAX_RETRIES` | Max retry attempts | `3` |
| `RETRY_DELAY` | Retry delay (seconds) | `1.0` |
| `ROUTES_CONFIG_FILE` | Path to routes JSON | `/config/routes.json` |

### Kafka Authentication

For secured Kafka clusters, set these additional environment variables:

```bash
KAFKA_SECURITY_PROTOCOL=SASL_SSL
KAFKA_SASL_MECHANISM=PLAIN
KAFKA_SASL_USERNAME=your-username
KAFKA_SASL_PASSWORD=your-password
```

## Kubernetes Deployment

### Using Helm

```bash
# Create a secret for Archestra token
kubectl create secret generic archestra-token \
  --from-literal=token=your-archestra-token

# Install the chart
helm install kafka-bridge ./helm \
  --set archestra.url=http://archestra-backend:9000 \
  --set archestra.existingSecret=archestra-token \
  --set kafka.bootstrapServers=kafka:9092 \
  --set prompts.customerSupport.id=your-prompt-id-1 \
  --set prompts.orderProcessing.id=your-prompt-id-2 \
  --set prompts.analytics.id=your-prompt-id-3
```

### With Custom Routes

Create a values file (`my-values.yaml`):

```yaml
archestra:
  url: http://archestra-backend:9000
  existingSecret: archestra-token

kafka:
  bootstrapServers: kafka:9092
  topics: "customer.events,orders.events,analytics.events"

routes:
  config:
    - name: customer-support
      topic_pattern: customer.events
      prompt_id: abc123-def456-...
    - name: order-processing
      topic_pattern: orders.*
      prompt_id: xyz789-abc123-...
    - name: analytics
      topic_pattern: analytics.events
      prompt_id: 123abc-456def-...
```

```bash
helm install kafka-bridge ./helm -f my-values.yaml
```

## Alternative Approaches

### Using Kafka Connect

For production environments, you might prefer using **Kafka Connect** with an HTTP Sink Connector:

```json
{
  "name": "archestra-http-sink",
  "config": {
    "connector.class": "io.confluent.connect.http.HttpSinkConnector",
    "tasks.max": "1",
    "topics": "customer.events",
    "http.api.url": "http://archestra:9000/v1/a2a/${prompt_id}",
    "headers": "Content-Type: application/json|Authorization: Bearer ${token}",
    "request.body.format": "json",
    "batch.json.as.array": "false"
  }
}
```

### Using Kafka Streams

For complex transformations, consider using Kafka Streams to pre-process messages before sending to Archestra.

## Architecture Details

### A2A Protocol

The bridge uses Archestra's A2A (Agent-to-Agent) protocol endpoint:

```
POST /v1/a2a/{promptId}
Authorization: Bearer {token}
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "method": "message/send",
  "params": {
    "message": {
      "parts": [
        {"kind": "text", "text": "Your message content here"}
      ]
    }
  }
}
```

### Message Flow

1. **Producer** sends message to Kafka topic (e.g., `customer.events`)
2. **Bridge** consumes message and matches against routes
3. **Transform** (optional) applies template to format message
4. **Send** message to Archestra via A2A endpoint
5. **Agent** processes and returns response
6. **Bridge** logs response (or can be extended to publish to response topic)

## Monitoring

### Enable Debug Logging

```bash
LOG_LEVEL=DEBUG docker-compose up kafka-bridge
```

### Kafka UI (Optional)

Start with the debug profile to include Kafka UI:

```bash
docker-compose --profile debug up -d
```

Access Kafka UI at http://localhost:8080

## Troubleshooting

### Bridge can't connect to Kafka

```bash
# Check Kafka is running
docker-compose ps kafka

# Check Kafka logs
docker-compose logs kafka

# Verify topic exists
docker-compose exec kafka kafka-topics --list --bootstrap-server localhost:9092
```

### Bridge can't connect to Archestra

```bash
# Test connectivity from bridge container
docker-compose exec kafka-bridge curl -v http://host.docker.internal:9000/health

# Check token is valid
curl -H "Authorization: Bearer $ARCHESTRA_TOKEN" http://localhost:9000/api/profiles
```

### Messages not being routed

1. Check the bridge logs for routing errors:
   ```bash
   docker-compose logs kafka-bridge | grep -i route
   ```

2. Verify prompt IDs are correct:
   ```bash
   curl -H "Authorization: Bearer $ARCHESTRA_TOKEN" \
     http://localhost:9000/api/prompts/$CUSTOMER_SUPPORT_PROMPT_ID
   ```

3. Ensure topics match route patterns in `config/routes.json`

## Production Considerations

1. **Scaling**: Increase `replicaCount` in Helm values for horizontal scaling
2. **Security**: Use Kafka SASL/SSL and Archestra team tokens with minimal permissions
3. **Monitoring**: Add Prometheus metrics and alerts
4. **Dead Letter Queue**: Implement DLQ for failed message handling
5. **Idempotency**: Consider adding message deduplication for exactly-once semantics

## License

This example is part of the Archestra Platform. See the main repository for license information.
