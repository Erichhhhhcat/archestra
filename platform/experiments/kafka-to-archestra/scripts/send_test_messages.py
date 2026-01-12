#!/usr/bin/env python3
"""
Test Script: Send sample messages to Kafka topics.

This script sends example messages to the three Kafka topics that the bridge
service consumes, allowing you to test the Kafka-to-Archestra integration.

Usage:
    python scripts/send_test_messages.py [--bootstrap-server localhost:9092]
"""

import argparse
import json
import time
from datetime import datetime
from uuid import uuid4

from confluent_kafka import Producer


def delivery_report(err, msg):
    """Callback for message delivery reports."""
    if err is not None:
        print(f"❌ Message delivery failed: {err}")
    else:
        print(f"✅ Message delivered to {msg.topic()} [{msg.partition()}] @ offset {msg.offset()}")


def send_customer_event(producer: Producer):
    """Send a sample customer support event."""
    message = {
        "event_id": str(uuid4()),
        "timestamp": datetime.utcnow().isoformat(),
        "customer_id": "CUST-12345",
        "issue_type": "technical_support",
        "priority": "high",
        "message": "I'm having trouble logging into my account. I've tried resetting my password twice but I still can't access it. The error message says 'Invalid credentials' even though I know my password is correct. Can you please help?",
    }

    print(f"\n📤 Sending customer support event...")
    print(f"   Topic: customer.events")
    print(f"   Message: {json.dumps(message, indent=2)}")

    producer.produce(
        "customer.events",
        key=message["customer_id"],
        value=json.dumps(message),
        callback=delivery_report,
    )
    producer.flush()


def send_order_event(producer: Producer):
    """Send a sample order processing event."""
    message = {
        "event_id": str(uuid4()),
        "timestamp": datetime.utcnow().isoformat(),
        "order_id": "ORD-67890",
        "event_type": "order_placed",
        "customer_email": "john.doe@example.com",
        "details": json.dumps({
            "items": [
                {"sku": "PROD-001", "name": "Wireless Mouse", "quantity": 2, "price": 29.99},
                {"sku": "PROD-002", "name": "USB-C Hub", "quantity": 1, "price": 49.99},
            ],
            "total": 109.97,
            "shipping_address": "123 Main St, Anytown, USA",
            "payment_method": "credit_card",
        }),
    }

    print(f"\n📤 Sending order event...")
    print(f"   Topic: orders.events")
    print(f"   Message: {json.dumps(message, indent=2)}")

    producer.produce(
        "orders.events",
        key=message["order_id"],
        value=json.dumps(message),
        callback=delivery_report,
    )
    producer.flush()


def send_analytics_event(producer: Producer):
    """Send a sample analytics event."""
    message = {
        "event_id": str(uuid4()),
        "timestamp": datetime.utcnow().isoformat(),
        "metric_name": "user_engagement_score",
        "value": 87.5,
        "dimensions": json.dumps({
            "region": "north_america",
            "product_line": "enterprise",
            "user_segment": "power_users",
        }),
        "context": "Weekly engagement metrics showing significant increase in enterprise user activity.",
    }

    print(f"\n📤 Sending analytics event...")
    print(f"   Topic: analytics.events")
    print(f"   Message: {json.dumps(message, indent=2)}")

    producer.produce(
        "analytics.events",
        key=message["metric_name"],
        value=json.dumps(message),
        callback=delivery_report,
    )
    producer.flush()


def main():
    parser = argparse.ArgumentParser(description="Send test messages to Kafka topics")
    parser.add_argument(
        "--bootstrap-server",
        default="localhost:9092",
        help="Kafka bootstrap server (default: localhost:9092)",
    )
    parser.add_argument(
        "--topic",
        choices=["customer", "order", "analytics", "all"],
        default="all",
        help="Which topic(s) to send to (default: all)",
    )
    parser.add_argument(
        "--repeat",
        type=int,
        default=1,
        help="Number of times to repeat sending messages (default: 1)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=2.0,
        help="Delay in seconds between messages (default: 2.0)",
    )

    args = parser.parse_args()

    print("=" * 60)
    print("Kafka Test Message Producer")
    print("=" * 60)
    print(f"Bootstrap server: {args.bootstrap_server}")
    print(f"Topic(s): {args.topic}")
    print(f"Repeat: {args.repeat} time(s)")

    # Create producer
    producer = Producer({
        "bootstrap.servers": args.bootstrap_server,
        "client.id": "test-producer",
    })

    try:
        for i in range(args.repeat):
            if args.repeat > 1:
                print(f"\n{'='*60}")
                print(f"Round {i + 1} of {args.repeat}")
                print("=" * 60)

            if args.topic in ("customer", "all"):
                send_customer_event(producer)
                time.sleep(args.delay)

            if args.topic in ("order", "all"):
                send_order_event(producer)
                time.sleep(args.delay)

            if args.topic in ("analytics", "all"):
                send_analytics_event(producer)

            if i < args.repeat - 1:
                print(f"\n⏳ Waiting {args.delay}s before next round...")
                time.sleep(args.delay)

    except KeyboardInterrupt:
        print("\n\n⚠️ Interrupted by user")
    finally:
        producer.flush()

    print("\n✅ Done!")


if __name__ == "__main__":
    main()
