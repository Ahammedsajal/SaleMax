"""Reject private/runtime artifacts and recognizable secrets before publication.
Prints only filenames and finding categories, never matching secret values.
This check is a publication aid, not a claim of a comprehensive security audit.
"""
import re
import subprocess
import sys
from pathlib import PurePosixPath

files = subprocess.check_output(['git', 'diff', '--cached', '--name-only', '-z']).decode().split('\0')
patterns = {
    'private-key': rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
    'github-token': rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b',
    'aws-access-key': rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
    'slack-token': rb'\bxox[baprs]-[A-Za-z0-9-]{20,}\b',
    'credential-assignment': rb'''(?i)(?:password|dbpass|client_secret|api_secret|access_token|refresh_token|smtp_pass)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{20,}["']''',
}
blocked = []
for name in filter(None, files):
    p = PurePosixPath(name)
    if any(part in {'node_modules', 'sessions', 'private-backups', 'local-runtime', 'server-access', '.playwright-mcp', 'rebrand-evidence'} for part in p.parts) or (p.name.startswith('.env') and p.name != '.env.example') or p.suffix.lower() in {'.pem', '.key', '.p12', '.tgz', '.zip', '.log'} or (p.suffix == '.sql' and p.parts[:2] != ('database', 'migrations')):
        blocked.append((name, 'private-or-runtime-path')); continue
    data = subprocess.check_output(['git', 'show', ':' + name])
    for category, pattern in patterns.items():
        if re.search(pattern, data): blocked.append((name, category))
if blocked:
    for name, category in blocked: print(f'BLOCKED {category}: {name}')
    sys.exit(1)
print(f'Publication check passed for {len(list(filter(None,files)))} staged files; no recognized secret patterns or private runtime paths.')
