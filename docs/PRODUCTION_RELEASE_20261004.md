# Course prerequisite field removal — production release, 4 October 2026

The create and edit forms on the existing Courses screen no longer display English or Arabic prerequisite fields. Course creation omits these values. Course edits continue sending the course's existing prerequisite metadata unchanged, preserving legacy data.

Release: `/opt/salemax/releases/training-course-prerequisites-removed-20261004` at `https://crm.salemax.qa`. The deployed asset cache key is `20261004-prerequisites-removed`; its SHA-256 is `e924718fecfc6199172154b3a445177cbb4435294775c6025986d91f27a73db6`. Production-specific course import behavior was preserved. No database migration or customer-data change was made. The previous app image is retained as `salemax-app:rollback-course-prerequisites-removed-20261004`, and the prior course asset/index are backed up under `/opt/salemax/shared/rollback-course-prerequisites-removed-20261004`.

After rebuilding only the SaleMaX app, the app and database report healthy, `/healthz` returns success, the live HTML references the new cache key, and the served asset hash matches the running container. The visible `Prerequisites` label is absent, while the edit request preserves existing prerequisite values. Authenticated browser acceptance was not performed. The earlier course card redesign and private image/PDF/video upload work are not part of this release.
