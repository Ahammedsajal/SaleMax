#!/bin/sh
set -eu

IMAGE=${1:?candidate image required}
DB_CONTAINER=${2:-salemax-app-1}
[ "${SALEMAX_DEPLOY_LOCK_HELD:-}" = 1 ] || { echo "Production deployment lock is required" >&2; exit 75; }

ENV_FILE=$(mktemp /opt/salemax/shared/.real-estate-migration.XXXXXX)
chmod 0600 "$ENV_FILE"
cleanup() { shred -u "$ENV_FILE" 2>/dev/null || true; }
trap cleanup EXIT HUP INT TERM

python3 - "$DB_CONTAINER" "$ENV_FILE" <<'PY'
import json, os, subprocess, sys
container, output = sys.argv[1:]
raw = subprocess.run(["docker", "inspect", container], check=True, capture_output=True, text=True).stdout
env = dict(item.split("=", 1) for item in json.loads(raw)[0]["Config"]["Env"] if "=" in item)
keys = ["DBHOST", "DBPORT", "DBUSER", "DBPASS", "DBNAME"]
missing = [key for key in ("DBHOST", "DBUSER", "DBNAME") if not env.get(key)]
if missing:
    raise SystemExit("DATABASE_CONFIG_REQUIRED:" + ",".join(missing))
if any("\n" in env.get(key, "") or "\r" in env.get(key, "") for key in keys):
    raise SystemExit("DATABASE_CONFIG_INVALID")
with open(output, "w", encoding="utf-8") as stream:
    for key in keys:
        if env.get(key) is not None:
            stream.write(key + "=" + env[key] + "\n")
os.chmod(output, 0o600)
PY

for migration in 20261222_real_estate_properties.sql 20270110_real_estate_units_and_listings.sql 20270111_real_estate_authority.sql 20270112_real_estate_agreement_parent.sql 20270113_real_estate_contact_documents.sql; do
  docker run --rm --network "container:$DB_CONTAINER" --env-file "$ENV_FILE" \
    --entrypoint node "$IMAGE" /app/database/migrate-pipeline.js --apply --only "$migration"
done
