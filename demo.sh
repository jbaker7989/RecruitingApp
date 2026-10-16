#!/bin/bash
# Run after seeding with the same DEMO_PASSWORD; never prints session tokens.
set -euo pipefail
: "${DEMO_PASSWORD:?Set DEMO_PASSWORD before running the demo}"
export DEMO_PASSWORD
BASE=http://localhost:3000
for role in applicant recruiter hiring-manager member-services; do
  body=$(DEMO_USERNAME="demo-$role" python3 -c 'import os,json; print(json.dumps({"username": os.environ["DEMO_USERNAME"], "password": os.environ["DEMO_PASSWORD"]}))')
  token=$(curl --fail --silent --show-error -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' --data-binary "$body" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
  echo "-- $role"
  curl --fail --silent --show-error -H "Authorization: Bearer $token" "$BASE/api/auth/me" | python3 -m json.tool
done
