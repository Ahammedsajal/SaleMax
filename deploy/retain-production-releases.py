#!/usr/bin/env python3
"""Retain active 7Network release inputs and the configured short rollback window.

Dry-run is the default. Run with --apply only on carsqatar-prod-01.
Older rollback snapshots under shared storage are preserved; this policy retires
their release directories after the retention window, so those old snapshots are
not guaranteed to be directly deployable without rebuilding their source.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


HOST = "carsqatar-prod-01"
RELEASES = Path("/opt/salemax/releases")
SHARED = Path("/opt/salemax/shared")
CURRENT = Path("/opt/salemax/current")
RELEASE_RE = re.compile(r"/opt/salemax/releases/([A-Za-z0-9._-]+)")
TEXT_SUFFIXES = {".json", ".txt", ".md", ".log", ".yml", ".yaml", ".sh", ".toml"}


def run(args: list[str]) -> str:
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE).strip()


def release_refs_in_recent_rollbacks(cutoff: float) -> set[str]:
    refs: set[str] = set()
    for entry in SHARED.iterdir():
        if not entry.name.startswith("rollback-") or not entry.is_dir():
            continue
        try:
            if entry.stat().st_mtime < cutoff:
                continue
        except OSError:
            continue
        for base, dirs, files in os.walk(entry):
            dirs.sort()
            for name in files:
                path = Path(base) / name
                if path.suffix.lower() not in TEXT_SUFFIXES:
                    continue
                try:
                    if path.stat().st_size > 10 * 1024 * 1024:
                        continue
                    refs.update(m.group(1) for m in RELEASE_RE.finditer(path.read_text(errors="ignore")))
                except OSError:
                    continue
    return refs


def active_release_refs() -> tuple[set[str], set[str]]:
    ids = run(["docker", "ps", "-q"]).split()
    containers = json.loads(run(["docker", "inspect", *ids])) if ids else []
    refs: set[str] = set()
    for container in containers:
        labels = (container.get("Config", {}).get("Labels") or {})
        for value in labels.get("com.docker.compose.project.config_files", "").split(","):
            match = RELEASE_RE.search(value)
            if match:
                refs.add(match.group(1))
        for mount in container.get("Mounts", []):
            match = RELEASE_RE.search(mount.get("Source", ""))
            if match:
                refs.add(match.group(1))
    match = RELEASE_RE.search(str(CURRENT.resolve()))
    if match:
        refs.add(match.group(1))
    return refs, set(ids)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="delete eligible old release directories")
    parser.add_argument("--rollback-window-hours", type=float, default=24)
    parser.add_argument("--staging-grace-minutes", type=float, default=60)
    options = parser.parse_args()

    if socket.gethostname() != HOST:
        parser.error(f"refusing to run on host {socket.gethostname()!r}; expected {HOST!r}")
    if not RELEASES.is_dir() or not SHARED.is_dir() or not CURRENT.is_symlink():
        parser.error("expected production release/shared paths and current symlink were not found")
    if options.rollback_window_hours < 1 or options.staging_grace_minutes < 5:
        parser.error("rollback window must be at least 1 hour and staging grace at least 5 minutes")

    lock_path = SHARED / ".release-retention.lock"
    lock = lock_path.open("a")
    os.chmod(lock_path, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("another release-retention run is active; exiting", file=sys.stderr)
        return 2

    now = time.time()
    rollback_cutoff = now - options.rollback_window_hours * 3600
    staging_cutoff = now - options.staging_grace_minutes * 60
    current_path = str(CURRENT.resolve())
    active_refs, active_ids = active_release_refs()
    recent_rollback_refs = release_refs_in_recent_rollbacks(rollback_cutoff)
    keep = active_refs | recent_rollback_refs
    entries = [entry for entry in RELEASES.iterdir() if entry.is_dir() and not entry.is_symlink()]
    staging = {entry.name for entry in entries if entry.stat().st_mtime >= staging_cutoff}
    keep.update(staging)
    candidates = sorted((entry for entry in entries if entry.name not in keep), key=lambda p: p.name)

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    manifest_dir = SHARED / f"maintenance-release-retention-{run_id}"
    if options.apply:
        manifest_dir.mkdir(mode=0o700)
    paths = [str(path) for path in candidates]
    estimated_bytes = 0
    if paths:
        output = run(["du", "-csx", "-B1", "--", *paths]).splitlines()[-1]
        estimated_bytes = int(output.split()[0])

    print(json.dumps({
        "mode": "apply" if options.apply else "dry-run",
        "host": HOST,
        "current_release": current_path,
        "running_container_count": len(active_ids),
        "live_release_refs": len(active_refs),
        "rollback_window_hours": options.rollback_window_hours,
        "recent_rollback_release_refs": len(recent_rollback_refs),
        "staging_release_dirs_kept": len(staging),
        "release_dirs_total": len(entries),
        "release_dirs_eligible": len(candidates),
        "eligible_release_names": [path.name for path in candidates],
        "estimated_reclaim_bytes": estimated_bytes,
        "manifest_dir": str(manifest_dir) if options.apply else None,
    }, sort_keys=True))

    if not options.apply:
        return 0

    plan_path = manifest_dir / "plan.jsonl"
    removed_path = manifest_dir / "removed.jsonl"
    with plan_path.open("w") as plan:
        for path in candidates:
            stat = path.stat()
            plan.write(json.dumps({"name": path.name, "mtime": stat.st_mtime}, ensure_ascii=True) + "\n")
        plan.flush()
        os.fsync(plan.fileno())

    with removed_path.open("w") as journal:
        for path in candidates:
            if str(CURRENT.resolve()) != current_path:
                raise RuntimeError("current release pointer changed during cleanup; stopped")
            current_refs, current_ids = active_release_refs()
            if current_refs & {path.name} or current_ids != active_ids:
                raise RuntimeError("live containers or references changed during cleanup; stopped")
            shutil.rmtree(path)
            journal.write(json.dumps({"name": path.name}, ensure_ascii=True) + "\n")
            journal.flush()
            os.fsync(journal.fileno())
    print(f"removed {len(candidates)} release directories; journal: {removed_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
