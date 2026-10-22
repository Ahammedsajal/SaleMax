#!/bin/sh
set -eu

image_tag=${1:-}
source_sha=${2:-}
build_context=${3:-}
case "$image_tag" in
  ''|latest|*[!a-zA-Z0-9_.-]*|[!a-zA-Z0-9_]*)
    echo "Usage: $0 <new immutable release tag> <40-character source commit SHA> [build context]" >&2
    exit 2
    ;;
esac
if [ "${#image_tag}" -gt 128 ]; then
  echo "Image tag must not exceed 128 characters" >&2
  exit 2
fi
case "$source_sha" in
  ''|*[!a-fA-F0-9]*)
    echo "Usage: $0 <new immutable release tag> <40-character source commit SHA> [build context]" >&2
    exit 2
    ;;
esac
if [ "${#source_sha}" -ne 40 ]; then
  echo "Source commit SHA must contain exactly 40 hexadecimal characters" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
dockerfile="$script_dir/Dockerfile"
build_context=${build_context:-"$script_dir/.."}
build_context=$(CDPATH= cd -- "$build_context" && pwd)
if [ ! -f "$build_context/package.json" ] || [ ! -f "$build_context/.dockerignore" ]; then
  echo "Build context must contain the reviewed app and .dockerignore" >&2
  exit 2
fi
image_ref="salemax-app:$image_tag"
if docker image inspect "$image_ref" >/dev/null 2>&1; then
  echo "Refusing to overwrite existing release image $image_ref" >&2
  exit 2
fi

docker build --pull \
  --build-arg "VCS_REF=$source_sha" \
  --tag "$image_ref" \
  --file "$dockerfile" \
  "$build_context"

image_id=$(docker image inspect --format '{{.Id}}' "$image_ref")
recorded_sha=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_ref")
if [ "$recorded_sha" != "$source_sha" ]; then
  docker image rm "$image_ref" >/dev/null
  echo "Image revision label mismatch; refusing release output" >&2
  exit 1
fi

printf 'image_ref=%s\nsource_sha=%s\nimage_id=%s\n' "$image_ref" "$source_sha" "$image_id"
