# Alternative Integration Approaches

This document describes alternative methods to integrate Kafka with Archestra beyond the Python bridge service provided in this example.

## 1. Kafka Connect HTTP Sink Connector

For production workloads, Kafka Connect offers a robust, scalable solution.

### Setup

1. Install Confluent HTTP Sink Connector:

```bash
confluent-hub install confluentinc/kafka-connect-http:latest
```

2. Create connector configuration:

```json
{
  "name": "archestra-a2a-sink",
  "config": {
    "connector.class": "io.confluent.connect.http.HttpSinkConnector",
    "tasks.max": "3",
    "topics": "customer.events",
    "http.api.url": "http://archestra:9000/v1/a2a/${prompt_id}",
    "headers": "Content-Type:application/json,Authorization:Bearer ${env:ARCHESTRA_TOKEN}",
    "request.method": "POST",
    "request.body.format": "json",
    "reporter.bootstrap.servers": "kafka:9092",
    "reporter.result.topic.name": "archestra-responses",
    "reporter.error.topic.name": "archestra-errors",
    "behavior.on.null.values": "ignore",
    "behavior.on.error": "log",
    "batch.max.size": 1,
    "retry.on.status.codes": "408,429,500,502,503,504",
    "max.retries": 3,
    "retry.backoff.ms": 1000
  }
}
```

### Single Message Transform (SMT)

Use SMTs to transform Kafka messages into A2A JSON-RPC format:

```json
{
  "transforms": "wrapA2A",
  "transforms.wrapA2A.type": "org.apache.kafka.connect.transforms.HoistField$Value",
  "transforms.wrapA2A.field": "message",
  "transforms.wrapA2A.predicate": "isNotNull"
}
```

Or create a custom SMT for complex transformations:

```java
public class A2ATransform implements Transformation<SinkRecord> {
    @Override
    public SinkRecord apply(SinkRecord record) {
        Map<String, Object> a2aMessage = new HashMap<>();
        a2aMessage.put("jsonrpc", "2.0");
        a2aMessage.put("id", UUID.randomUUID().toString());
        a2aMessage.put("method", "message/send");
        
        Map<String, Object> params = new HashMap<>();
        Map<String, Object> message = new HashMap<>();
        List<Map<String, String>> parts = new ArrayList<>();
        
        Map<String, String> textPart = new HashMap<>();
        textPart.put("kind", "text");
        textPart.put("text", record.value().toString());
        parts.add(textPart);
        
        message.put("parts", parts);
        params.put("message", message);
        a2aMessage.put("params", params);
        
        return record.newRecord(
            record.topic(),
            record.kafkaPartition(),
            record.keySchema(),
            record.key(),
            null,
            a2aMessage,
            record.timestamp()
        );
    }
}
```

## 2. Node.js/TypeScript Bridge

For teams preferring JavaScript/TypeScript:

```typescript
// kafka-bridge.ts
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';

interface Route {
  name: string;
  topicPattern: string | RegExp;
  promptId: string;
}

class KafkaArchestraBridge {
  private kafka: Kafka;
  private consumer: Consumer;
  private archestraUrl: string;
  private archestraToken: string;
  private routes: Route[];

  constructor(config: {
    kafkaBrokers: string[];
    groupId: string;
    archestraUrl: string;
    archestraToken: string;
    routes: Route[];
  }) {
    this.kafka = new Kafka({
      clientId: 'archestra-bridge',
      brokers: config.kafkaBrokers,
    });
    this.consumer = this.kafka.consumer({ groupId: config.groupId });
    this.archestraUrl = config.archestraUrl;
    this.archestraToken = config.archestraToken;
    this.routes = config.routes;
  }

  async start(topics: string[]): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topics, fromBeginning: true });

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await this.processMessage(payload);
      },
    });
  }

  private async processMessage({ topic, message }: EachMessagePayload): Promise<void> {
    const route = this.findRoute(topic);
    if (!route) {
      console.warn(`No route found for topic: ${topic}`);
      return;
    }

    const messageContent = message.value?.toString() || '';
    
    try {
      const response = await fetch(`${this.archestraUrl}/v1/a2a/${route.promptId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.archestraToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: crypto.randomUUID(),
          method: 'message/send',
          params: {
            message: {
              parts: [{ kind: 'text', text: messageContent }],
            },
          },
        }),
      });

      const result = await response.json();
      console.log(`Processed message from ${topic}:`, result);
    } catch (error) {
      console.error(`Failed to process message from ${topic}:`, error);
    }
  }

  private findRoute(topic: string): Route | undefined {
    return this.routes.find(route => {
      if (typeof route.topicPattern === 'string') {
        return topic === route.topicPattern || 
               (route.topicPattern.includes('*') && 
                topic.startsWith(route.topicPattern.replace('*', '')));
      }
      return route.topicPattern.test(topic);
    });
  }
}

// Usage
const bridge = new KafkaArchestraBridge({
  kafkaBrokers: ['localhost:9092'],
  groupId: 'archestra-bridge',
  archestraUrl: 'http://localhost:9000',
  archestraToken: process.env.ARCHESTRA_TOKEN!,
  routes: [
    { name: 'customer-support', topicPattern: 'customer.events', promptId: 'xxx' },
    { name: 'orders', topicPattern: /^orders\./, promptId: 'yyy' },
  ],
});

bridge.start(['customer.events', 'orders.events', 'orders.notifications']);
```

## 3. AWS Lambda with MSK

For serverless deployments on AWS:

```python
# lambda_function.py
import json
import os
import uuid
import base64
import urllib3

http = urllib3.PoolManager()

ARCHESTRA_URL = os.environ['ARCHESTRA_URL']
ARCHESTRA_TOKEN = os.environ['ARCHESTRA_TOKEN']

# Topic to prompt ID mapping
ROUTES = {
    'customer.events': os.environ.get('CUSTOMER_SUPPORT_PROMPT_ID'),
    'orders.events': os.environ.get('ORDER_PROCESSING_PROMPT_ID'),
    'analytics.events': os.environ.get('ANALYTICS_PROMPT_ID'),
}

def handler(event, context):
    """AWS Lambda handler for MSK trigger."""
    results = []
    
    for record in event['records'].values():
        for message in record:
            topic = message['topic']
            value = base64.b64decode(message['value']).decode('utf-8')
            
            prompt_id = ROUTES.get(topic)
            if not prompt_id:
                print(f"No route for topic: {topic}")
                continue
            
            response = send_to_archestra(prompt_id, value)
            results.append({
                'topic': topic,
                'success': response is not None,
            })
    
    return {
        'statusCode': 200,
        'body': json.dumps({'processed': len(results)}),
    }

def send_to_archestra(prompt_id: str, message: str) -> dict:
    """Send message to Archestra A2A endpoint."""
    payload = {
        'jsonrpc': '2.0',
        'id': str(uuid.uuid4()),
        'method': 'message/send',
        'params': {
            'message': {
                'parts': [{'kind': 'text', 'text': message}]
            }
        }
    }
    
    response = http.request(
        'POST',
        f"{ARCHESTRA_URL}/v1/a2a/{prompt_id}",
        body=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {ARCHESTRA_TOKEN}',
        }
    )
    
    if response.status == 200:
        return json.loads(response.data.decode('utf-8'))
    else:
        print(f"Error: {response.status} - {response.data}")
        return None
```

## 4. Apache Camel Integration

For enterprise integration scenarios:

```xml
<!-- camel-context.xml -->
<camelContext xmlns="http://camel.apache.org/schema/spring">
    <route id="kafka-to-archestra">
        <from uri="kafka:customer.events?brokers=localhost:9092&amp;groupId=archestra-bridge"/>
        
        <setHeader name="CamelHttpMethod">
            <constant>POST</constant>
        </setHeader>
        <setHeader name="Content-Type">
            <constant>application/json</constant>
        </setHeader>
        <setHeader name="Authorization">
            <simple>Bearer {{archestra.token}}</simple>
        </setHeader>
        
        <process ref="a2aMessageTransformer"/>
        
        <toD uri="http://archestra:9000/v1/a2a/{{customer.support.prompt.id}}"/>
        
        <log message="Archestra response: ${body}"/>
    </route>
</camelContext>
```

## 5. Direct LLM Proxy Integration

Instead of A2A, you can also use Archestra's LLM Proxy directly:

```python
# Using Archestra as OpenAI-compatible endpoint
from openai import OpenAI

client = OpenAI(
    base_url="http://archestra:9000/v1/openai/{profile_id}",
    api_key=os.environ["ARCHESTRA_TOKEN"],
)

def process_kafka_message(message: str) -> str:
    response = client.chat.completions.create(
        model="gpt-4o",  # Model configured in profile
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": message},
        ],
    )
    return response.choices[0].message.content
```

## Comparison

| Approach | Pros | Cons |
|----------|------|------|
| Python Bridge (this example) | Simple, flexible, easy to customize | Requires separate deployment |
| Kafka Connect | Production-ready, scalable, managed | More complex setup |
| Node.js Bridge | Good for JS/TS teams | Similar to Python approach |
| AWS Lambda + MSK | Serverless, auto-scaling | AWS-specific, cold starts |
| Apache Camel | Enterprise features, many connectors | Heavy, complex |
| Direct LLM Proxy | Simpler API | No A2A protocol benefits |

Choose based on your:
- Infrastructure (cloud provider, container orchestration)
- Team expertise
- Scalability requirements
- Operational preferences
