#!/usr/bin/env bash
set -euo pipefail

mount_path="${SALEMAX_CAPACITY_PATH:-/}"
state_dir="${SALEMAX_CAPACITY_STATE_DIR:-/var/lib/7network-ops/capacity}"
state_file="$state_dir/last-severity"
free_warning_bytes=$((5 * 1024 * 1024 * 1024))

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

previous=normal
if [[ -f "$state_file" ]]; then IFS= read -r previous < "$state_file" || previous=normal; fi
if [[ "$severity" == "$previous" || ( "$severity" == normal && "$previous" == normal ) ]]; then exit 0; fi

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
  message="7Network host capacity recovered on ${host} at ${timestamp}. Disk ${disk_percent}% used (${disk_free_bytes} bytes free); inodes ${inode_percent}% used."
else
  message="7Network host capacity ${severity} on ${host} at ${timestamp}. Disk ${disk_percent}% used (${disk_free_bytes} bytes free); inodes ${inode_percent}% used."
fi
payload="$(printf '{\"text\":\"%s\"}' "$message")"
response_code="$(curl --fail --silent --show-error --max-time 10 --retry 2 --output /dev/null --write-out '%{http_code}' \
  -H 'Content-Type: application/json' --data-binary "$payload" "$webhook")"
[[ "$response_code" =~ ^2[0-9][0-9]$ ]] || { echo "Capacity webhook returned HTTP $response_code; alert state was not advanced" >&2; exit 1; }

temporary="$state_file.$$"
printf '%s\n' "$severity" > "$temporary"
chmod 0640 "$temporary"
mv -f "$temporary" "$state_file"
printf '[7network-capacity] webhook_accepted severity=%s disk=%s%% free=%s bytes inode=%s%%\n' \
  "$severity" "$disk_percent" "$disk_free_bytes" "$inode_percent"
