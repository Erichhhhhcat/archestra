.PHONY: help build up down logs test clean

# Default target
help:
	@echo "Kafka to Archestra Bridge - Available commands:"
	@echo ""
	@echo "  make build     - Build the bridge Docker image"
	@echo "  make up        - Start all services (Kafka + Bridge)"
	@echo "  make up-debug  - Start all services including Kafka UI"
	@echo "  make down      - Stop all services"
	@echo "  make logs      - View bridge service logs"
	@echo "  make test      - Send test messages to Kafka"
	@echo "  make clean     - Remove containers and volumes"
	@echo ""
	@echo "Prerequisites:"
	@echo "  1. Copy .env.example to .env and configure"
	@echo "  2. Create agents in Archestra and get prompt IDs"
	@echo ""

# Build the bridge Docker image
build:
	docker-compose build kafka-bridge

# Start all services
up: build
	docker-compose up -d
	@echo ""
	@echo "Services started! View logs with: make logs"

# Start with Kafka UI for debugging
up-debug: build
	docker-compose --profile debug up -d
	@echo ""
	@echo "Services started with Kafka UI!"
	@echo "  - Kafka UI: http://localhost:8080"
	@echo "  - Bridge logs: make logs"

# Stop all services
down:
	docker-compose down

# View bridge logs
logs:
	docker-compose logs -f kafka-bridge

# Send test messages
test:
	@if [ -f .env ]; then \
		python scripts/send_test_messages.py; \
	else \
		echo "Error: .env file not found. Copy .env.example to .env first."; \
		exit 1; \
	fi

# Alternative test using shell script
test-shell:
	./scripts/send_test_messages.sh

# Clean up everything
clean:
	docker-compose down -v --remove-orphans
	@echo "Cleaned up containers and volumes"

# Create topics manually
create-topics:
	docker-compose exec kafka kafka-topics --create --if-not-exists \
		--topic customer.events --partitions 3 --replication-factor 1 \
		--bootstrap-server localhost:9092
	docker-compose exec kafka kafka-topics --create --if-not-exists \
		--topic orders.events --partitions 3 --replication-factor 1 \
		--bootstrap-server localhost:9092
	docker-compose exec kafka kafka-topics --create --if-not-exists \
		--topic analytics.events --partitions 3 --replication-factor 1 \
		--bootstrap-server localhost:9092

# List topics
list-topics:
	docker-compose exec kafka kafka-topics --list --bootstrap-server localhost:9092

# Consume from a topic (for debugging)
consume-customer:
	docker-compose exec kafka kafka-console-consumer \
		--topic customer.events --from-beginning \
		--bootstrap-server localhost:9092

consume-orders:
	docker-compose exec kafka kafka-console-consumer \
		--topic orders.events --from-beginning \
		--bootstrap-server localhost:9092

consume-analytics:
	docker-compose exec kafka kafka-console-consumer \
		--topic analytics.events --from-beginning \
		--bootstrap-server localhost:9092

# Helm commands
helm-install:
	@if [ -z "$(ARCHESTRA_TOKEN)" ]; then \
		echo "Error: ARCHESTRA_TOKEN not set"; \
		exit 1; \
	fi
	kubectl create secret generic archestra-token \
		--from-literal=token=$(ARCHESTRA_TOKEN) \
		--dry-run=client -o yaml | kubectl apply -f -
	helm install kafka-bridge ./helm

helm-upgrade:
	helm upgrade kafka-bridge ./helm

helm-uninstall:
	helm uninstall kafka-bridge
	kubectl delete secret archestra-token --ignore-not-found
