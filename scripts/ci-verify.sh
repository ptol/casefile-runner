#!/usr/bin/env bash
set -euo pipefail

npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run pack:check
