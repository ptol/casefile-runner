#!/usr/bin/env bash
set -euo pipefail

npm ci
npm run build

release_version="${CI_COMMIT_TAG#v}"
node ./scripts/set-release-version-from-tag.mjs "$release_version" "${CI_COMMIT_TAG:-}"

if [[ -z "${NPM_ID_TOKEN:-}" ]]; then
  echo "NPM_ID_TOKEN is missing. Configure GitLab id_tokens for npm Trusted Publishing."
  exit 1
fi

if [[ -z "${SIGSTORE_ID_TOKEN:-}" ]]; then
  echo "SIGSTORE_ID_TOKEN is missing. Configure GitLab id_tokens for provenance."
  exit 1
fi

npm publish --access public
