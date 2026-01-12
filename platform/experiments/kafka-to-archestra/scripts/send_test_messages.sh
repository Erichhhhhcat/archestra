#!/bin/bash
#
# Send test messages to Kafka topics using kafka-console-producer
# This script can be run from outside Docker or inside the Kafka container.
#
# Usage:
#   ./scripts/send_test_messages.sh                    # Send to localhost:9092
#   ./scripts/send_test_messages.sh kafka:29092        # Send to Docker internal network
#
# Or via Docker:
#   docker-compose exec kafka /bin/bash -c "cat /dev/stdin | kafka-console-producer ..."

BOOTSTRAP_SERVER="${1:-localhost:9092}"

echo "================================"
echo "Kafka Test Message Producer"
echo "================================"
echo "Bootstrap server: $BOOTSTRAP_SERVER"
echo ""

# Function to send a message
send_message() {
    local topic=$1
    local message=$2
    echo "📤 Sending to $topic..."
    echo "$message" | docker-compose exec -T kafka kafka-console-producer \
        --bootstrap-server kafka:29092 \
        --topic "$topic" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "✅ Message sent to $topic"
    else
        echo "❌ Failed to send to $topic"
    fi
    echo ""
}

# Customer support event
CUSTOMER_MSG='{"event_id":"test-001","timestamp":"2025-01-12T10:00:00Z","customer_id":"CUST-12345","issue_type":"billing","priority":"medium","message":"I was charged twice for my subscription this month. Order IDs: ORD-111 and ORD-222. Please refund the duplicate charge."}'

# Order event
ORDER_MSG='{"event_id":"test-002","timestamp":"2025-01-12T10:05:00Z","order_id":"ORD-99999","event_type":"order_shipped","customer_email":"customer@example.com","details":"{\"tracking_number\":\"1Z999AA10123456784\",\"carrier\":\"UPS\",\"estimated_delivery\":\"2025-01-15\"}"}'

# Analytics event
ANALYTICS_MSG='{"event_id":"test-003","timestamp":"2025-01-12T10:10:00Z","metric_name":"conversion_rate","value":3.45,"dimensions":"{\"channel\":\"organic\",\"device\":\"mobile\",\"region\":\"EU\"}","context":"Conversion rate dropped 15% compared to last week."}'

echo "Sending test messages..."
echo ""

send_message "customer.events" "$CUSTOMER_MSG"
sleep 1

send_message "orders.events" "$ORDER_MSG"
sleep 1

send_message "analytics.events" "$ANALYTICS_MSG"

echo "================================"
echo "✅ All test messages sent!"
echo "================================"
echo ""
echo "Check the bridge logs to see the messages being processed:"
echo "  docker-compose logs -f kafka-bridge"
