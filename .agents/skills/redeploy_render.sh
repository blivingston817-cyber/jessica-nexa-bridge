#!/bin/bash
# Triggers a manual deploy of jessica-nexa-bridge on Render
# Usage: run this skill any time after pushing code changes to GitHub

source /app/.agents/.env

SERVICE_ID="srv-d785gdhr0fns738ghht0"

echo "Triggering Render deploy..."
RESULT=$(curl -s -X POST \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$SERVICE_ID/deploys")

DEPLOY_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
STATUS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
COMMIT=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('commit',{}).get('message',''))")

echo "Deploy ID: $DEPLOY_ID"
echo "Status: $STATUS"
echo "Commit: $COMMIT"

if [ -z "$DEPLOY_ID" ]; then
  echo "ERROR: Deploy failed"
  exit 1
fi

# Poll until live or failed
echo "Waiting for deploy to complete..."
for i in {1..20}; do
  sleep 10
  CHECK=$(curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
    "https://api.render.com/v1/services/$SERVICE_ID/deploys/$DEPLOY_ID")
  CURRENT_STATUS=$(echo "$CHECK" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
  echo "  [$i] Status: $CURRENT_STATUS"
  if [ "$CURRENT_STATUS" = "live" ]; then
    echo "✅ Deploy successful — jessica-nexa-bridge is live!"
    exit 0
  elif [ "$CURRENT_STATUS" = "failed" ] || [ "$CURRENT_STATUS" = "canceled" ]; then
    echo "❌ Deploy $CURRENT_STATUS"
    exit 1
  fi
done

echo "⚠️ Timed out waiting — check Render dashboard"
