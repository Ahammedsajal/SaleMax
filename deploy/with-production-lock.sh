#!/bin/sh
set -eu

LOCK_FILE=/opt/salemax/shared/7network-production-deploy.lock
CURRENT_LINK=/opt/salemax/current
RELEASE_ROOT=/opt/salemax/releases/

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <one synchronous preflight/deploy/verify/rollback command> [args...]" >&2
  exit 2
fi

command -v flock >/dev/null 2>&1 || {
  echo "flock is required; refusing an unlocked production operation" >&2
  exit 69
}

umask 077

# The lock file may not exist yet on an older host. Create it exclusively so
# simultaneous first runs converge on the same inode instead of truncating or
# replacing each other's lock. Never follow a pre-existing symlink or lock a
# special file.
if [ -L "$LOCK_FILE" ]; then
  echo "The shared production deployment lock must not be a symlink" >&2
  exit 73
fi
if [ ! -e "$LOCK_FILE" ]; then
  if ! (set -C; : > "$LOCK_FILE") 2>/dev/null && [ ! -e "$LOCK_FILE" ]; then
    echo "Cannot create the shared production deployment lock" >&2
    exit 73
  fi
fi
if [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ]; then
  echo "The shared production deployment lock must be a regular file" >&2
  exit 73
fi

if ! { exec 9>>"$LOCK_FILE"; } 2>/dev/null; then
  echo "Cannot open the shared production deployment lock" >&2
  exit 73
fi

if flock -n -E 75 9; then
  :
else
  status=$?
  if [ "$status" -eq 75 ]; then
    echo "Another 7Network production operation holds the deployment lock" >&2
  else
    echo "Failed to acquire the shared production deployment lock (status $status)" >&2
  fi
  exit "$status"
fi

# Resolve only after acquiring the lock so preflight sees any deployment that
# completed while this operation was waiting to start.
active_release=$(readlink -f "$CURRENT_LINK") || {
  echo "Cannot resolve the active production release" >&2
  exit 1
}
case "$active_release" in
  "$RELEASE_ROOT"*) ;;
  *)
    echo "Active release resolves outside $RELEASE_ROOT; refusing deployment" >&2
    exit 1
    ;;
esac
[ -d "$active_release" ] || {
  echo "Resolved active release is not a directory" >&2
  exit 1
}

export SALEMAX_ACTIVE_RELEASE_BEFORE="$active_release"
export SALEMAX_DEPLOY_LOCK_HELD=1
export SALEMAX_DEPLOY_LOCK_FD=9
cd "$active_release"
printf 'Production lock acquired; active release re-resolved as %s\n' "$active_release"

# Keep this process synchronous. The lock remains held until the complete
# command returns, including its verification or rollback path.
if "$@"; then
  exit 0
else
  status=$?
  exit "$status"
fi
