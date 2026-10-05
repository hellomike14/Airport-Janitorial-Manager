#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mapfile -t backend_tests < <(find "$ROOT/artifacts/api-server/src" -type f -name '*.test.ts' | sort)
frontend_auth_tests=(
  "$ROOT/artifacts/marvol-cleaning/src/lib/authBootstrapRecovery.test.ts"
  "$ROOT/artifacts/marvol-cleaning/src/lib/resolveStaffSession.test.ts"
)

echo "== Backend Node tests =="
pnpm --filter @workspace/api-server exec tsx --test "${backend_tests[@]}"

echo "== Frontend authentication Node tests =="
pnpm --filter @workspace/api-server exec tsx --test "${frontend_auth_tests[@]}"

echo "== Controlled access-flow service integration tests =="
pnpm --filter @workspace/api-server exec tsx --test "$ROOT/tests/access-flow.integration.test.ts"

echo "== Workspace typecheck =="
pnpm run typecheck

echo "== Production builds =="
PORT="${PORT:-20025}" BASE_PATH="${BASE_PATH:-/}" pnpm --filter @workspace/api-server --filter @workspace/marvol-cleaning run build

echo "Access-flow release checks passed."