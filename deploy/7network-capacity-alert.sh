#!/usr/bin/env bash
set -euo pipefail

mount_path="${SALEMAX_CAPACITY_PATH:-/}"
state_dir="${SALEMAX_CAPACITY_STATE_DIR:-/var/lib/7network-ops/capacity}"
state_file="$state_dir/last-severity"
releases_path="${SALEMAX_RELEASES_PATH:-/opt/salemax/releases}"
release_baseline_file="$state_dir/releases-baseline-bytes"
release_growth_warning_bytes="${SALEMAX_RELEASE_GROWTH_WARNING_BYTES:-2147483648}"
release_growth_critical_bytes="${SALEMAX_RELEASE_GROWTH_CRITICAL_BYTES:-5368709120}"
image_baseline_file="$state_dir/docker-image-baseline-bytes"
image_growth_warning_bytes="${SALEMAX_IMAGE_GROWTH_WARNING_BYTES:-2147483648}"
image_growth_critical_bytes="${SALEMAX_IMAGE_GROWTH_CRITICAL_BYTES:-5368709120}"
free_warning_bytes=$((5 * 1024 * 1024 * 1024))

for threshold in "$release_growth_warning_bytes" "$release_growth_critical_bytes" "$image_growth_warning_bytes" "$image_growth_critical_bytes"; do
  [[ "$threshold" =~ ^[0-9]+$ ]] && (( threshold > 0 )) || { echo 'Release growth thresholds must be positive integers' >&2; exit 1; }
done
(( release_growth_critical_bytes >= release_growth_warning_bytes )) || {
  echo 'Critical release growth threshold must be at least the warning threshold' >&2
  exit 1
}
(( image_growth_critical_bytes >= image_growth_warning_bytes )) || {
  echo 'Critical Docker image growth threshold must be at least the warning threshold' >&2
  exit 1
}

mkdir -p "$state_dir"
chmod 0750 "$state_dir"
exec 9>"$state_dir/monitor.lock"
flock -n 9 || exit 0

disk_line="$(df -B1 --output=size,used,avail,pcent -- "$mount_path" | awk 'NR==2 { gsub(/%/, "", $5); print $2, $3, $4, $5 }')"
inode_line="$(df -i --output=itotal,iused,iavail,ipcent -- "$mount_path" | awk 'NR==2 { gsub(/%/, "", $5); print $2, $3, $4, $5 }')"
read -r disk_total_bytes disk_used_bytes disk_free_bytes disk_percent <<< "$disk_line"
read -r inode_total inode_used inode_free inode_percent <<< "$inode_line"

for metric in "$disk_total_bytes" "$disk_used_bytes" "$disk_free_bytes" "$disk_percent" "$inode_total" "$inode_used" "$inode_free" "$inode_percent"; do
  [[ "$metric" =~ ^[0-9]+$ ]] || { echo "Unable to read valid disk and inode metrics for $mount_path" >&2; exit 1; }
done

severity=normal
severity_rank=0
raise_severity() {
  local candidate="$1" rank="$2"
  if (( rank > severity_rank )); then severity="$candidate"; severity_rank="$rank"; fi
}
threshold_severity() {
  local percent="$1"
  if (( percent >= 90 )); then raise_severity critical 3
  elif (( percent >= 85 )); then raise_severity urgent 2
  elif (( percent >= 75 )); then raise_severity warning 1
  fi
}

threshold_severity "$disk_percent"
threshold_severity "$inode_percent"
if (( disk_free_bytes < free_warning_bytes )); then raise_severity warning 1; fi

[[ -d "$releases_path" ]] || { echo "Release path is unavailable: $releases_path" >&2; exit 1; }
release_size_line="$(du -sx --block-size=1 -- "$releases_path" | awk 'NR==1 {print $1}')"
[[ "$release_size_line" =~ ^[0-9]+$ ]] || { echo "Unable to read release tree size for $releases_path" >&2; exit 1; }
release_bytes=$release_size_line
release_baseline=$release_bytes
baseline_changed=0
if [[ -f "$release_baseline_file" ]]; then
  IFS= read -r release_baseline < "$release_baseline_file" || release_baseline=''
else
  baseline_changed=1
fi
if [[ ! "$release_baseline" =~ ^[0-9]+$ ]]; then
  release_baseline=$release_bytes
  baseline_changed=1
fi
release_growth_bytes=0
if (( release_bytes >= release_baseline )); then
  release_growth_bytes=$((release_bytes - release_baseline))
else
  # A reduced release tree starts a new growth window after reviewed cleanup.
  release_baseline=$release_bytes
  baseline_changed=1
fi
if (( baseline_changed )); then
  baseline_temporary="$release_baseline_file.$$"
  printf '%s\n' "$release_baseline" > "$baseline_temporary"
  chmod 0640 "$baseline_temporary"
  mv -f "$baseline_temporary" "$release_baseline_file"
fi

# Docker reports virtual image sizes and can count shared layers repeatedly.
# Use this as a growth signal, never as an estimate of reclaimable disk bytes.
image_ids_output="$(timeout 20 docker image ls --no-trunc --quiet | sort -u)" || {
  echo 'Unable to list Docker images for growth monitoring' >&2
  exit 1
}
image_bytes=0
if [[ -n "$image_ids_output" ]]; then
  IFS=$'\n' read -r -a image_ids <<< "$image_ids_output"
  image_sizes="$(timeout 30 docker image inspect --format '{{.Size}}' "${image_ids[@]}")" || {
    echo 'Unable to inspect Docker image sizes for growth monitoring' >&2
    exit 1
  }
  while IFS= read -r image_size; do
    [[ "$image_size" =~ ^[0-9]+$ ]] || { echo 'Docker returned an invalid image size' >&2; exit 1; }
    image_bytes=$((image_bytes + image_size))
  done <<< "$image_sizes"
fi
image_baseline=$image_bytes
image_baseline_changed=0
if [[ -f "$image_baseline_file" ]]; then
  IFS= read -r image_baseline < "$image_baseline_file" || image_baseline=''
else
  image_baseline_changed=1
fi
if [[ ! "$image_baseline" =~ ^[0-9]+$ ]]; then
  image_baseline=$image_bytes
  image_baseline_changed=1
fi
image_growth_bytes=0
if (( image_bytes >= image_baseline )); then
  image_growth_bytes=$((image_bytes - image_baseline))
else
  image_baseline=$image_bytes
  image_baseline_changed=1
fi
if (( image_baseline_changed )); then
  image_baseline_temporary="$image_baseline_file.$$"
  printf '%s\n' "$image_baseline" > "$image_baseline_temporary"
  chmod 0640 "$image_baseline_temporary"
  mv -f "$image_baseline_temporary" "$image_baseline_file"
fi

release_growth_state=none
if (( release_growth_bytes >= release_growth_critical_bytes )); then
  release_growth_state=critical
  raise_severity critical 3
elif (( release_growth_bytes >= release_growth_warning_bytes )); then
  release_growth_state=warning
  raise_severity urgent 2
fi
image_growth_state=none
if (( image_growth_bytes >= image_growth_critical_bytes )); then
  image_growth_state=critical
  raise_severity critical 3
elif (( image_growth_bytes >= image_growth_warning_bytes )); then
  image_growth_state=warning
  raise_severity urgent 2
fi

health_failures=()
inspect_service() {
  local service="$1" requires_health="$2" ids id state running health
  ids="$(timeout 10 docker ps -q \
    --filter label=com.docker.compose.project=salemax \
    --filter "label=com.docker.compose.service=$service" 2>/dev/null)" || ids=""
  if [[ -z "$ids" ]]; then
    health_failures+=("$service")
    return
  fi

  for id in $ids; do
    state="$(timeout 10 docker inspect --format '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null)" || state=unknown
    IFS='|' read -r running health <<< "$state"
    if [[ "$running" != true || ( "$requires_health" == true && "$health" != healthy ) ]]; then
      health_failures+=("$service")
      return
    fi
  done
}

# App, database and dedicated workers expose Docker health checks. Worker
# readiness is a recent successful poll, not merely a running Node process.
inspect_service app true
inspect_service db true
inspect_service report-worker true
inspect_service recruitment-founder-notification-worker true
if (( ${#health_failures[@]} > 0 )); then raise_severity critical 3; fi

health_state=none
if (( ${#health_failures[@]} > 0 )); then
  health_state="$(IFS=,; printf '%s' "${health_failures[*]}")"
fi
current_state="$severity|$health_state|$release_growth_state|$image_growth_state"
previous_state='normal|none|none|none'
if [[ -f "$state_file" ]]; then IFS= read -r previous_state < "$state_file" || previous_state='normal|none|none|none'; fi
# Read state written by the original severity-only, health-only and release-growth monitors.
IFS='|' read -r previous_severity previous_health_state previous_release_growth_state previous_image_growth_state <<< "$previous_state"
[[ -n "$previous_severity" ]] || previous_severity=normal
[[ -n "$previous_health_state" ]] || previous_health_state=none
[[ -n "$previous_release_growth_state" ]] || previous_release_growth_state=none
[[ -n "$previous_image_growth_state" ]] || previous_image_growth_state=none
previous_state="$previous_severity|$previous_health_state|$previous_release_growth_state|$previous_image_growth_state"
if [[ "$current_state" == "$previous_state" ]]; then exit 0; fi

webhook="${SALEMAX_CAPACITY_ALERT_WEBHOOK_URL:-}"
if [[ ! "$webhook" =~ ^https://[^[:space:]]+$ ]]; then
  printf '[7network-capacity] severity=%s disk=%s%% free=%s inode=%s%%; HTTPS alert webhook is not configured\n' \
    "$severity" "$disk_percent" "$disk_free_bytes" "$inode_percent" >&2
  exit 2
fi

host="$(hostname -f 2>/dev/null || hostname)"
host="$(printf '%s' "$host" | tr -cd '[:alnum:]._-')"
timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [[ "$severity" == normal ]]; then
  message="7Network host capacity and service health recovered on ${host} at ${timestamp}. Disk ${disk_percent}% used (${disk_free_bytes} bytes free); inodes ${inode_percent}% used."
  if [[ "$previous_release_growth_state" != none ]]; then message+=" Release tree growth returned below threshold."; fi
  if [[ "$previous_image_growth_state" != none ]]; then message+=" Docker image growth returned below threshold (virtual sizes may include shared layers)."; fi
else
  message="7Network host capacity ${severity} on ${host} at ${timestamp}. Disk ${disk_percent}% used (${disk_free_bytes} bytes free); inodes ${inode_percent}% used."
  if (( ${#health_failures[@]} > 0 )); then message+="; unhealthy or missing services: ${health_state}."; fi
  if [[ "$health_state" == none && "$previous_health_state" != none ]]; then message+=" Service health recovered; capacity remains ${severity}."; fi
  if [[ "$release_growth_state" != none ]]; then message+=" Release tree growth ${release_growth_state}: ${release_growth_bytes} bytes over baseline."; fi
  if [[ "$release_growth_state" == none && "$previous_release_growth_state" != none ]]; then message+=" Release tree growth returned below threshold; capacity remains ${severity}."; fi
  if [[ "$image_growth_state" != none ]]; then message+=" Docker image virtual-size growth ${image_growth_state}: ${image_growth_bytes} bytes over baseline (shared layers may be counted more than once)."; fi
  if [[ "$image_growth_state" == none && "$previous_image_growth_state" != none ]]; then message+=" Docker image growth returned below threshold; capacity remains ${severity}."; fi
fi
payload="$(printf '{\"text\":\"%s\"}' "$message")"
response_code="$(curl --fail --silent --show-error --max-time 10 --retry 2 --output /dev/null --write-out '%{http_code}' \
  -H 'Content-Type: application/json' --data-binary "$payload" "$webhook")"
[[ "$response_code" =~ ^2[0-9][0-9]$ ]] || { echo "Capacity webhook returned HTTP $response_code; alert state was not advanced" >&2; exit 1; }

temporary="$state_file.$$"
printf '%s\n' "$current_state" > "$temporary"
chmod 0640 "$temporary"
mv -f "$temporary" "$state_file"
printf '[7network-capacity] webhook_accepted severity=%s disk=%s%% free=%s bytes inode=%s%% services=%s release_growth=%s bytes image_growth=%s virtual-bytes\n' \
  "$severity" "$disk_percent" "$disk_free_bytes" "$inode_percent" "$health_state" "$release_growth_bytes" "$image_growth_bytes"
