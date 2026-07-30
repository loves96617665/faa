#!/usr/bin/env bash
# DaFreeAi Studio v1 API — curl example
set -euo pipefail

BASE="${BASE:-https://faa.kinai.workers.dev}"
FAA_KEY="${FAA_KEY:?export FAA_KEY=faa_sk_... first}"

echo "== models =="
curl -sS -H "Authorization: Bearer $FAA_KEY" "$BASE/v1/models" | head -c 500
echo
echo

echo "== me =="
curl -sS -H "Authorization: Bearer $FAA_KEY" "$BASE/v1/me"
echo
echo

echo "== generate =="
JOB=$(curl -sS -X POST "$BASE/v1/generate" \
  -H "Authorization: Bearer $FAA_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a cute orange cat, soft light","model":"nano-banana-2-lite","aspect":"1:1","resolution":"1K"}')
echo "$JOB"
CHAT=$(printf '%s' "$JOB" | sed -n 's/.*"chatId":"\([^"]*\)".*/\1/p' | head -n1)
if [ -z "$CHAT" ]; then
  echo "No chatId — abort poll"
  exit 1
fi

echo
echo "== poll $CHAT =="
for i in $(seq 1 40); do
  RES=$(curl -sS -H "Authorization: Bearer $FAA_KEY" "$BASE/v1/jobs/$CHAT")
  echo "#$i $RES" | head -c 300
  echo
  echo "$RES" | grep -q '"status":"completed"' && break
  echo "$RES" | grep -q '"status":"error"' && break
  sleep 3
done
