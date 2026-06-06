#!/usr/bin/env bash
# Deploy leaf-web to leaf.gundem.tech.
#
# Steps:
#   1) Build  — fresh `pnpm build` into dist/
#   2) Backup — tarball of current /var/www/leaf/ on VPS, dated
#   3) Sync   — rsync --delete dist/ to /var/www/leaf/
#   4) Reload — systemctl reload nginx
#   5) Verify — curl key URLs, RSS validates, /api/contact still proxied
#
# Override SSH host with:  SSH_HOST=user@1.2.3.4 ./scripts/deploy.sh
# Skip backup (NOT recommended) with:  SKIP_BACKUP=1 ./scripts/deploy.sh
# Skip the build (use existing dist/) with:  SKIP_BUILD=1 ./scripts/deploy.sh

set -euo pipefail

# leaf-vps — алиас из ~/.ssh/config на деплой-машине (host+user там, не в
# публичном репо: origin за Cloudflare). Деплой-юзер имеет rsync в
# /var/www/leaf без sudo и NOPASSWD на nginx -t / systemctl reload nginx.
SSH_HOST="${SSH_HOST:-leaf-vps}"
REMOTE_PATH="${REMOTE_PATH:-/var/www/leaf}"
BACKUP_DIR="${BACKUP_DIR:-~/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/leaf-pre-deploy-${STAMP}.tar.gz"
SITE_URL="${SITE_URL:-https://leaf.gundem.tech}"

cd "$(dirname "$0")/.."

cyan()  { printf "\033[1;36m%s\033[0m\n" "$*"; }
green() { printf "\033[1;32m%s\033[0m\n" "$*"; }
red()   { printf "\033[1;31m%s\033[0m\n" "$*"; }

cyan "[1/5] Build"
if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  echo "  → skipped (SKIP_BUILD=1)"
else
  pnpm build
fi

if [[ ! -d dist ]]; then red "ERROR: dist/ missing — build failed?"; exit 1; fi
PAGES_COUNT="$(find dist -name '*.html' | wc -l | tr -d ' ')"
echo "  → built $PAGES_COUNT HTML pages"

cyan "[2/5] Backup current site on VPS"
if [[ "${SKIP_BACKUP:-0}" == "1" ]]; then
  red "  → WARNING: SKIP_BACKUP=1 — production swap with no rollback tarball"
else
  ssh "$SSH_HOST" "mkdir -p ${BACKUP_DIR} && tar -czf ${BACKUP_FILE} -C $(dirname ${REMOTE_PATH}) $(basename ${REMOTE_PATH}) && ls -lh ${BACKUP_FILE}"
  green "  → backup at $SSH_HOST:${BACKUP_FILE}"
fi

cyan "[3/5] Rsync dist/ → ${SSH_HOST}:${REMOTE_PATH}/"
rsync -avz --delete \
  --exclude='/api/' \
  --exclude='/changelog/latest.json' \
  --exclude='/admin/' \
  --exclude='/webhook/' \
  --exclude='/.well-known/' \
  dist/ "$SSH_HOST:${REMOTE_PATH}/"

cyan "[4/5] Reload nginx"
ssh "$SSH_HOST" "sudo nginx -t && sudo systemctl reload nginx"
green "  → nginx reloaded"

cyan "[5/5] Verify"
for path in "/" "/product" "/pricing" "/privacy" "/open-source" "/changelog" "/changelog/feed.xml" "/signup" "/dashboard" "/terms"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "${SITE_URL}${path}")"
  if [[ "$code" =~ ^2 ]]; then
    green "  ✓ ${path} → ${code}"
  else
    red   "  ✗ ${path} → ${code}"
  fi
done

# RSS validity sanity check — body should start with <?xml + contain <rss
rss_head="$(curl -s "${SITE_URL}/changelog/feed.xml" | head -c 200)"
if grep -q '<rss' <<<"$rss_head"; then
  green "  ✓ /changelog/feed.xml is valid RSS"
else
  red   "  ✗ /changelog/feed.xml not recognized as RSS"
fi

# Version badge must match the live Sparkle appcast (single source of truth —
# src/lib/version.ts fetches it at build time; mismatch = stale build artifact).
# Load-bearing check: a mismatch FAILS the deploy (exit 1 below) so callers
# (release.sh step_site) don't stamp a stale site as success.
VERSION_VERIFY_FAILED=0
appcast_ver="$(curl -s https://updates.gundem.tech/appcast.xml \
  | grep -oE '<sparkle:shortVersionString>[^<]+' | sed 's/.*>//' | head -1)"
site_ver="$(curl -s "${SITE_URL}/" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?' | head -1)"
if [[ -n "$appcast_ver" && "v${appcast_ver}" == "$site_ver" ]]; then
  green "  ✓ site version ${site_ver} matches appcast"
else
  red   "  ✗ site version '${site_ver}' ≠ appcast 'v${appcast_ver}' — rebuild without SKIP_BUILD?"
  VERSION_VERIFY_FAILED=1
fi

# /api/contact must still be proxied (we excluded it from rsync delete)
api_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${SITE_URL}/api/contact" -H 'Content-Type: application/json' -d '{}')"
echo "  api/contact responded ${api_code} (expect 400/422 — endpoint reachable, body invalid)"

cyan "Done."
if [[ "${SKIP_BACKUP:-0}" != "1" ]]; then
  echo "Rollback if needed:  ssh ${SSH_HOST} 'tar -xzf ${BACKUP_FILE} -C $(dirname ${REMOTE_PATH})'"
fi

if [[ "$VERSION_VERIFY_FAILED" -eq 1 ]]; then
  red "DEPLOY VERIFY FAILED: live site version ≠ appcast. Deploy is NOT successful."
  exit 1
fi
