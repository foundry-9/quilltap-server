#!/bin/bash
#
# Fetch the latest ECS logs from CloudWatch
# Usage: ./scripts/ecs-logs.sh [limit]
#   limit: Number of log events to fetch (default: 100)
#

set -e

LOG_GROUP="/ecs/quilltap-dev"
REGION="us-east-1"
LIMIT="${1:-100}"

# Get the latest log stream name
LATEST_STREAM=$(aws logs describe-log-streams \
    --log-group-name "$LOG_GROUP" \
    --region "$REGION" \
    --order-by LastEventTime \
    --descending \
    --limit 1 \
    --query 'logStreams[0].logStreamName' \
    --output text)

if [ -z "$LATEST_STREAM" ] || [ "$LATEST_STREAM" = "None" ]; then
    echo "Error: Could not find any log streams in $LOG_GROUP" >&2
    exit 1
fi

echo "Fetching logs from stream: $LATEST_STREAM" >&2

# Get log events and extract messages
aws logs get-log-events \
    --log-group-name "$LOG_GROUP" \
    --log-stream-name "$LATEST_STREAM" \
    --region "$REGION" \
    --limit "$LIMIT" \
    | jq -r '.events[].message'
