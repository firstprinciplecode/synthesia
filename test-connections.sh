#!/bin/bash

echo "🔍 Testing connections endpoint..."
echo "=================================="

echo ""
echo "1. Testing /api/connections endpoint..."
curl -s -w "\nStatus: %{http_code}\n" \
  -H "x-user-id: thomas@firstprinciple.co" \
  -H "Content-Type: application/json" \
  "https://agent.firstprinciple.co/api/connections" | jq '.' 2>/dev/null || echo "Response (raw):"
curl -s \
  -H "x-user-id: thomas@firstprinciple.co" \
  -H "Content-Type: application/json" \
  "https://agent.firstprinciple.co/api/connections"

echo ""
echo "=================================="
echo "2. Testing other endpoints for comparison..."

echo ""
echo "Testing /api/profile..."
curl -s -w "\nStatus: %{http_code}\n" \
  -H "x-user-id: thomas@firstprinciple.co" \
  "https://agent.firstprinciple.co/api/profile" | jq '.id, .name, .email' 2>/dev/null || echo "Raw response:"
curl -s \
  -H "x-user-id: thomas@firstprinciple.co" \
  "https://agent.firstprinciple.co/api/profile"

echo ""
echo "Testing /api/agents/accessible..."
curl -s -w "\nStatus: %{http_code}\n" \
  -H "x-user-id: thomas@firstprinciple.co" \
  "https://agent.firstprinciple.co/api/agents/accessible" | jq '. | length' 2>/dev/null || echo "Raw response:"
curl -s \
  -H "x-user-id: thomas@firstprinciple.co" \
  "https://agent.firstprinciple.co/api/agents/accessible"

echo ""
echo "Testing /api/conversations..."
curl -s -w "\nStatus: %{http_code}\n" \
  -H "x-user-id: thomas@firstprinciple.co" \
  "https://agent.firstprinciple.co/api/conversations" | jq '. | length' 2>/dev/null || echo "Raw response:"
curl -s \
  -H "x-user-id: thomas@firstprinciple.co" \
  "https://agent.firstprinciple.co/api/conversations"

echo ""
echo "Testing /api/relationships..."
curl -s -w "\nStatus: %{http_code}\n" \
  -H "x-user-id: thomas@firstprinciple.co" \
  "https://agent.firstprinciple.co/api/relationships" | jq '.' 2>/dev/null || echo "Raw response:"
curl -s \
  -H "x-user-id: thomas@firstprinciple.co" \
  "https://agent.firstprinciple.co/api/relationships"

echo ""
echo "=================================="
echo "3. Testing relationship creation..."

echo ""
echo "POST /api/relationships..."
curl -s -w "\nStatus: %{http_code}\n" \
  -X POST \
  -H "x-user-id: thomas@firstprinciple.co" \
  -H "Content-Type: application/json" \
  -d '{"toActorId": "test-actor-id", "kind": "follow"}' \
  "https://agent.firstprinciple.co/api/relationships" | jq '.' 2>/dev/null || echo "Raw response:"
curl -s \
  -X POST \
  -H "x-user-id: thomas@firstprinciple.co" \
  -H "Content-Type: application/json" \
  -d '{"toActorId": "test-actor-id", "kind": "follow"}' \
  "https://agent.firstprinciple.co/api/relationships"

echo ""
echo "=================================="
echo "Test completed!"
