# 7Network Docker build and release policy

## Build the production artifact once

- `deploy/Dockerfile` uses the official Node 22.23.3 Bookworm slim multi-architecture image pinned to the Docker Hub manifest digest `sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9`. Update that digest through a reviewed security update; do not use floating `node:22` tags for release builds.
- Build dependencies (`git`, Python, Make and the C++ compiler) exist only in the build stage. The runtime stage retains the current ffmpeg and WebRTC libraries, production Node dependencies, application source and the existing non-root `node` account.
- Build on the current single server from the staged release context, under a new release tag. The context can be derived from the active release to preserve reviewed production-only files; pass the full source commit SHA as `VCS_REF` and record any live-derived overlay hashes plus the resulting Docker image ID. A release tag is write-once; never retag it to different image bytes.
- Set `SALEMAX_IMAGE_TAG` to that verified tag for Compose. The app, report worker and recruitment notification worker all resolve the same local image. Compose has no build section and uses `pull_policy: never`, so activation cannot rebuild or silently pull another image.
- Preserve the active Compose file's production-only services, host mappings and persistent mounts when preparing each release. Run the candidate's configuration and runtime smoke checks before changing `/opt/salemax/current`; then verify the container image ID equals the built ID after activation.

Build and preflight (run from a clean, reviewed source checkout):

```sh
SOURCE_SHA="$(git rev-parse HEAD)"
SALEMAX_IMAGE_TAG="7network-${SOURCE_SHA:0:12}-YYYYMMDD"
BUILD_CONTEXT="$(pwd)"
deploy/build-image.sh "$SALEMAX_IMAGE_TAG" "$SOURCE_SHA" "$BUILD_CONTEXT"
SALEMAX_IMAGE_TAG="$SALEMAX_IMAGE_TAG" docker compose \
  --env-file /opt/salemax/shared/stack.env \
  --file deploy/compose.yml config --quiet
```

Do not activate an image until its embedded revision matches the reviewed source SHA, any live-derived overlay hashes match the record, and the Compose configuration resolves every application service to that tag. Compose activation uses the staged image and `--no-build`; it does not rebuild.

## Retention and disk controls

- Keep the active release, the five most recent verified releases, and every release referenced by an active rollback snapshot or an unresolved deployment record. Keep the matching active and rollback image IDs/tags for the same set. Do not delete an image or release while any container, rollback procedure, or protected snapshot refers to it.
- Perform cleanup as a dry-run inventory first. Prune only individually verified, unreferenced `salemax-app` release images; never use broad `docker system prune`, volume pruning, or age-only deletion. Keep other products' images, all customer volumes, uploads, database backups, sessions and rollback snapshots.
- Alert at 75% root filesystem use (warning), 85% (urgent), and 90% (critical); also alert when less than 5 GiB remains. Resolve both percentage and free-space thresholds before a build. The 22 October 2026 production snapshot is 85% used with 7.8 GB free, 560 release directories and 16 GB in Docker images. The 7.8 GB measurement is a single point, not a capacity guarantee.
- The same snapshot showed 12.2 GB total host memory, 9.8 GB available, load average 0.36/0.22/0.32, app 197 MiB of its 1 GiB limit and MariaDB 407 MiB of its 768 MiB limit. Collect a seven-day peak and concurrency baseline for CPU, RSS, I/O, connection count, queue delay and disk growth before setting customer or tenant capacity promises.
- The production host currently shares storage and Docker with Carsqatar. Disk cleanup and Docker build activity must account for that neighbor; never remove non-SaleMaX images or volumes.
- Alert delivery has not yet been connected to a verified monitoring destination. The thresholds above are policy, not an operational alert. The goal remains gated until an alert reaches an operator and a simulated threshold crossing is acknowledged.

## Current rollout gates

This is a source candidate only. The local execution environment has no Docker CLI/daemon, so an image build, native dependency smoke check, and image-size comparison were not run. Production was inspected read-only and was not built or changed. Before this Docker increment can be released, build it from the exact reviewed source state, verify image identity and the existing voice, image, and WebRTC paths in a disposable runtime, and record release/rollback evidence in `DEPLOYMENT.md`. The existing production 7Network/SaleMaX domain behavior stays in place until the broader migration acceptance is complete.

The policy does not authorize horizontal scaling. Before adding app instances, make every upload/media path shared and durable, move sessions to a supported shared store, and prove every scheduled job has a distributed claim/lease or another single-run guarantee. Database capacity, backups and restore drills remain separate release gates.
