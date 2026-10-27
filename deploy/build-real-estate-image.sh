#!/bin/sh
set -eu

SOURCE_COMMIT=${1:?source commit required}
IMAGE_TAG=${2:?image tag required}
BUILD_CONTEXT=${3:?build context required}
BASE_IMAGE=${4:?base image required}

case "$SOURCE_COMMIT" in *[!0-9a-f]*|'') echo "Invalid source commit" >&2; exit 2;; esac
[ "${#SOURCE_COMMIT}" -eq 40 ] || { echo "Invalid source commit" >&2; exit 2; }
case "$IMAGE_TAG" in *[!A-Za-z0-9_.:/-]*|'') echo "Invalid image tag" >&2; exit 2;; esac
[ -d "$BUILD_CONTEXT" ] || { echo "Build context is missing" >&2; exit 2; }
[ -f "$BUILD_CONTEXT/deploy/build-real-estate-overlay.cjs" ] || { echo "Build helper is missing" >&2; exit 2; }
[ "${SALEMAX_DEPLOY_LOCK_HELD:-}" = 1 ] || { echo "Production deployment lock is required" >&2; exit 75; }

CONTAINER="salemax-real-estate-build-$(date +%s)-$$"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM

docker create --name "$CONTAINER" --user 0 --entrypoint node "$BASE_IMAGE" -e 'setInterval(()=>{},2147483647)' >/dev/null	docker start "$CONTAINER" >/dev/null
docker cp "$BUILD_CONTEXT/." "$CONTAINER:/tmp/real-estate-build-context"
docker exec --user 0 "$CONTAINER" node /tmp/real-estate-build-context/deploy/build-real-estate-overlay.cjs /app /tmp/real-estate-build-context
docker commit \
  --change 'ENTRYPOINT ["docker-entrypoint.sh"]' \
  --change 'CMD ["node","server.js"]' \
  --change 'WORKDIR /app' \
  --change 'USER node' \
  --change "LABEL org.7network.overlay.commit=$SOURCE_COMMIT" \
  "$CONTAINER" "$IMAGE_TAG" >/dev/null
docker image inspect "$IMAGE_TAG" --format '{{.Id}} {{.Config.User}} {{json .Config.Cmd}}'
