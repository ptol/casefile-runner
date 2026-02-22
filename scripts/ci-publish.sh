#!/usr/bin/env bash
set -euo pipefail

npm ci
npm run build

tag_value="${CI_COMMIT_TAG:-${GITHUB_REF_NAME:-}}"
if [[ -z "$tag_value" ]]; then
  echo "No release tag was found. Expected CI_COMMIT_TAG or GITHUB_REF_NAME."
  exit 1
fi

release_version="${tag_value#v}"
node ./scripts/set-release-version-from-tag.mjs "$release_version" "$tag_value"

if [[ -z "${NODE_AUTH_TOKEN:-}" && -z "${NPM_TOKEN:-}" ]]; then
  echo "Missing npm auth token. Set NODE_AUTH_TOKEN or NPM_TOKEN in CI."
  exit 1
fi

npm publish --access public
