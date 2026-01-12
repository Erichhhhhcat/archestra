#!/usr/bin/env python3
"""
Kafka to Archestra Bridge Service

This service consumes messages from Kafka topics and routes them to Archestra agents
via the A2A (Agent-to-Agent) protocol endpoint.

Messages are routed based on configurable rules that match:
- Kafka topic names
- Message headers
- Message content fields

Each route maps to a specific Archestra prompt/agent.
"""

import json
import logging
import os
import signal
import sys
import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional

import requests
from confluent_kafka import Consumer, KafkaError, KafkaException

# Configure logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("kafka-archestra-bridge")


@dataclass
class RouteConfig:
    """Configuration for routing Kafka messages to Archestra agents."""

    name: str
    topic_pattern: str  # Kafka topic name or pattern
    prompt_id: str  # Archestra prompt ID to route to
    header_match: Optional[dict[str, str]] = None  # Optional header matching
    field_match: Optional[dict[str, str]] = None  # Optional JSON field matching
    transform_template: Optional[str] = None  # Optional message transformation


@dataclass
class BridgeConfig:
    """Main configuration for the Kafka-Archestra bridge."""

    # Archestra configuration
    archestra_url: str
    archestra_token: str

    # Kafka configuration
    kafka_bootstrap_servers: str
    kafka_group_id: str
    kafka_topics: list[str]

    # Routing configuration
    routes: list[RouteConfig]

    # Optional settings
    poll_timeout: float = 1.0
    max_retries: int = 3
    retry_delay: float = 1.0


def load_config() -> BridgeConfig:
    """Load configuration from environment variables and config file."""

    # Load routes from JSON config file or environment
    routes_json = os.getenv("ROUTES_CONFIG")
    routes_file = os.getenv("ROUTES_CONFIG_FILE", "/config/routes.json")

    if routes_json:
        routes_data = json.loads(routes_json)
    elif os.path.exists(routes_file):
        with open(routes_file, "r") as f:
            routes_data = json.load(f)
    else:
        # Default example routes
        routes_data = [
            {
                "name": "customer-support",
                "topic_pattern": "customer.events",
                "prompt_id": os.getenv("CUSTOMER_SUPPORT_PROMPT_ID", ""),
                "header_match": {"event_type": "support_request"},
            },
            {
                "name": "order-processing",
                "topic_pattern": "orders.events",
                "prompt_id": os.getenv("ORDER_PROCESSING_PROMPT_ID", ""),
            },
            {
                "name": "analytics-insights",
                "topic_pattern": "analytics.*",
                "prompt_id": os.getenv("ANALYTICS_PROMPT_ID", ""),
            },
        ]

    routes = [
        RouteConfig(
            name=r.get("name", f"route-{i}"),
            topic_pattern=r["topic_pattern"],
            prompt_id=r["prompt_id"],
            header_match=r.get("header_match"),
            field_match=r.get("field_match"),
            transform_template=r.get("transform_template"),
        )
        for i, r in enumerate(routes_data)
    ]

    # Extract unique topics from routes
    topics = list(set(r.topic_pattern.replace("*", "") for r in routes if r.topic_pattern))
    if not topics:
        topics = os.getenv("KAFKA_TOPICS", "archestra.events").split(",")

    return BridgeConfig(
        archestra_url=os.getenv("ARCHESTRA_URL", "http://localhost:9000"),
        archestra_token=os.getenv("ARCHESTRA_TOKEN", ""),
        kafka_bootstrap_servers=os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"),
        kafka_group_id=os.getenv("KAFKA_GROUP_ID", "archestra-bridge"),
        kafka_topics=topics,
        routes=routes,
        poll_timeout=float(os.getenv("POLL_TIMEOUT", "1.0")),
        max_retries=int(os.getenv("MAX_RETRIES", "3")),
        retry_delay=float(os.getenv("RETRY_DELAY", "1.0")),
    )


class ArchestraClient:
    """Client for communicating with Archestra A2A endpoint."""

    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }
        )

    def send_message(self, prompt_id: str, message: str, metadata: Optional[dict] = None) -> dict:
        """
        Send a message to an Archestra agent via the A2A protocol.

        Args:
            prompt_id: The Archestra prompt ID to send to
            message: The text message content
            metadata: Optional metadata to include

        Returns:
            The A2A response containing the agent's reply
        """
        url = f"{self.base_url}/v1/a2a/{prompt_id}"

        payload = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "message/send",
            "params": {
                "message": {
                    "parts": [{"kind": "text", "text": message}],
                }
            },
        }

        if metadata:
            payload["params"]["metadata"] = metadata

        logger.debug(f"Sending to {url}: {json.dumps(payload, indent=2)}")

        response = self.session.post(url, json=payload, timeout=60)
        response.raise_for_status()

        result = response.json()
        logger.debug(f"Received response: {json.dumps(result, indent=2)}")

        return result


class KafkaArchestraBridge:
    """Main bridge service that consumes Kafka messages and routes to Archestra."""

    def __init__(self, config: BridgeConfig):
        self.config = config
        self.running = False
        self.consumer: Optional[Consumer] = None
        self.archestra = ArchestraClient(config.archestra_url, config.archestra_token)

    def _match_route(self, topic: str, headers: dict, message_data: Any) -> Optional[RouteConfig]:
        """Find the matching route for a message."""
        for route in self.config.routes:
            # Check topic pattern
            pattern = route.topic_pattern
            if "*" in pattern:
                # Simple wildcard matching
                prefix = pattern.replace("*", "")
                if not topic.startswith(prefix):
                    continue
            elif topic != pattern:
                continue

            # Check header matching
            if route.header_match:
                if not all(headers.get(k) == v for k, v in route.header_match.items()):
                    continue

            # Check field matching (for JSON messages)
            if route.field_match and isinstance(message_data, dict):
                if not all(message_data.get(k) == v for k, v in route.field_match.items()):
                    continue

            return route

        return None

    def _transform_message(self, route: RouteConfig, message_data: Any) -> str:
        """Transform the message according to route configuration."""
        if route.transform_template:
            # Simple template substitution
            template = route.transform_template
            if isinstance(message_data, dict):
                for key, value in message_data.items():
                    template = template.replace(f"{{{key}}}", str(value))
            return template

        # Default: stringify the message
        if isinstance(message_data, dict):
            return json.dumps(message_data, indent=2)
        return str(message_data)

    def _process_message(self, topic: str, headers: dict, value: bytes) -> None:
        """Process a single Kafka message."""
        # Try to parse as JSON
        try:
            message_data = json.loads(value.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            message_data = value.decode("utf-8", errors="replace")

        # Find matching route
        route = self._match_route(topic, headers, message_data)

        if not route:
            logger.warning(f"No matching route for topic '{topic}', skipping message")
            return

        if not route.prompt_id:
            logger.error(f"Route '{route.name}' has no prompt_id configured, skipping")
            return

        # Transform message
        message_text = self._transform_message(route, message_data)

        # Send to Archestra with retries
        for attempt in range(self.config.max_retries):
            try:
                logger.info(
                    f"Routing message from topic '{topic}' to agent via prompt '{route.prompt_id}' (route: {route.name})"
                )

                result = self.archestra.send_message(
                    prompt_id=route.prompt_id,
                    message=message_text,
                    metadata={
                        "source": "kafka",
                        "topic": topic,
                        "route": route.name,
                    },
                )

                if "error" in result:
                    logger.error(f"Archestra returned error: {result['error']}")
                else:
                    response_text = (
                        result.get("result", {})
                        .get("parts", [{}])[0]
                        .get("text", "No response")
                    )
                    logger.info(f"Agent response: {response_text[:200]}...")

                break  # Success, exit retry loop

            except requests.RequestException as e:
                logger.warning(f"Failed to send to Archestra (attempt {attempt + 1}): {e}")
                if attempt < self.config.max_retries - 1:
                    time.sleep(self.config.retry_delay)
                else:
                    logger.error(f"Max retries exceeded for message on topic '{topic}'")

    def start(self) -> None:
        """Start the bridge service."""
        logger.info("Starting Kafka-Archestra Bridge")
        logger.info(f"Archestra URL: {self.config.archestra_url}")
        logger.info(f"Kafka servers: {self.config.kafka_bootstrap_servers}")
        logger.info(f"Topics: {self.config.kafka_topics}")
        logger.info(f"Routes configured: {len(self.config.routes)}")

        for route in self.config.routes:
            logger.info(f"  - {route.name}: {route.topic_pattern} -> {route.prompt_id or '(not configured)'}")

        # Create Kafka consumer
        consumer_config = {
            "bootstrap.servers": self.config.kafka_bootstrap_servers,
            "group.id": self.config.kafka_group_id,
            "auto.offset.reset": "earliest",
            "enable.auto.commit": True,
        }

        # Add optional Kafka configuration from environment
        if os.getenv("KAFKA_SECURITY_PROTOCOL"):
            consumer_config["security.protocol"] = os.getenv("KAFKA_SECURITY_PROTOCOL")
        if os.getenv("KAFKA_SASL_MECHANISM"):
            consumer_config["sasl.mechanism"] = os.getenv("KAFKA_SASL_MECHANISM")
        if os.getenv("KAFKA_SASL_USERNAME"):
            consumer_config["sasl.username"] = os.getenv("KAFKA_SASL_USERNAME")
        if os.getenv("KAFKA_SASL_PASSWORD"):
            consumer_config["sasl.password"] = os.getenv("KAFKA_SASL_PASSWORD")

        self.consumer = Consumer(consumer_config)
        self.consumer.subscribe(self.config.kafka_topics)

        self.running = True
        logger.info("Bridge started, consuming messages...")

        while self.running:
            try:
                msg = self.consumer.poll(timeout=self.config.poll_timeout)

                if msg is None:
                    continue

                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        logger.debug(f"End of partition: {msg.topic()}/{msg.partition()}")
                    else:
                        raise KafkaException(msg.error())
                    continue

                # Extract headers
                headers = {}
                if msg.headers():
                    headers = {h[0]: h[1].decode("utf-8") if h[1] else None for h in msg.headers()}

                # Process the message
                self._process_message(msg.topic(), headers, msg.value())

            except KafkaException as e:
                logger.error(f"Kafka error: {e}")
            except Exception as e:
                logger.exception(f"Error processing message: {e}")

    def stop(self) -> None:
        """Stop the bridge service."""
        logger.info("Stopping Kafka-Archestra Bridge")
        self.running = False
        if self.consumer:
            self.consumer.close()


def main():
    """Main entry point."""
    config = load_config()

    if not config.archestra_token:
        logger.error("ARCHESTRA_TOKEN environment variable is required")
        sys.exit(1)

    bridge = KafkaArchestraBridge(config)

    # Handle shutdown signals
    def signal_handler(signum, frame):
        logger.info(f"Received signal {signum}, shutting down...")
        bridge.stop()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        bridge.start()
    except Exception as e:
        logger.exception(f"Bridge failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
