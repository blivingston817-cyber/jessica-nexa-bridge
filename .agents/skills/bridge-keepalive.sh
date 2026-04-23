#!/bin/bash

BRIDGE_URL="https://jessica-nexa-bridge.onrender.com/health"
TIMESTAMP=$(date -Iseconds)

# Ping the bridge with a 10-second timeout
RESPONSE=$(curl -s --max-time 10 "$BRIDGE_URL" 2>&1)
HTTP_CODE=$?

if [ $HTTP_CODE -eq 0 ]; then
  STATUS=$(echo "$RESPONSE" | jq -r '.status // "unknown"' 2>/dev/null)
  if [ "$STATUS" = "ok" ]; then
    echo "✅ [$TIMESTAMP] Bridge is healthy"
  else
    echo "⚠️  [$TIMESTAMP] Bridge responded but status unclear: $RESPONSE"
  fi
else
  echo "❌ [$TIMESTAMP] Bridge ping failed (curl error $HTTP_CODE): $RESPONSE"
fi
