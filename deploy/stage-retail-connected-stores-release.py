"""Package the reviewed Connected Stores runtime files from one pushed commit."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'deploy/retail-connected-stores-runtime-manifest.txt'
BRANCH = 'codex/retail-commerce'


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def parse_manifest():
    rows = []
    for line in MANIFEST.read_text().splitlines():
        expected, path = line.split(maxsplit=1)
        if expected != 'new' and not re.fullmatch(r'[a-f0-9]{64}', expected):
            raise ValueError('Invalid baseline hash in runtime manifest')
        if Path(path).is_absolute() or '..' in Path(path).parts or path in {'', '.'}:
            raise ValueError('Invalid runtime path in manifest')
        rows.append((expected, path))
    if not rows or len({path for _, path in rows}) != len(rows):
        raise ValueError('Runtime manifest is empty or duplicated')
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('commit', help='full source commit already pushed to the feature branch')
    parser.add_argument('archive', type=Path, help='output .tar.gz artifact')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{40}', args.commit):
        raise ValueError('Pass a full commit SHA')
    commit = git('rev-parse', args.commit).decode().strip()
    remote = git('rev-parse', 'origin/' + BRANCH).decode().strip()
    if commit != remote:
        raise ValueError('Source commit is not the pushed feature branch tip')

    rows = parse_manifest()
    with tempfile.TemporaryDirectory(prefix='7network-connected-stores-stage-') as temp:
        stage = Path(temp) / 'retail-commerce'
        stage.mkdir()
        (stage / 'manifest.txt').write_text(MANIFEST.read_text())
        (stage / 'source-commit.txt').write_text(commit + '\n')
        runner = stage / 'deploy/retail-connected-stores-release.py'
        runner.parent.mkdir(parents=True)
        runner.write_bytes(git('show', commit + ':deploy/retail-connected-stores-release.py'))
        digest_map = {}
        for _, relative in rows:
            entry = git('ls-tree', commit, '--', relative).decode().strip()
            if not entry:
                raise ValueError('Runtime file is absent from source commit: ' + relative)
            mode = entry.split(maxsplit=1)[0]
            if mode not in {'100644', '100755'}:
                raise ValueError('Runtime path is not a regular Git file: ' + relative)
            content = git('show', commit + ':' + relative)
            digest_map[relative] = hashlib.sha256(content).hexdigest()
            target = stage / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        (stage / 'artifact-hashes.json').write_text(
            json.dumps(digest_map, sort_keys=True, indent=2) + '\n')
        archive = args.archive.resolve()
        archive.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive, 'w:gz') as output:
            output.add(stage, arcname='retail-commerce')
    print(json.dumps({'commit': commit, 'files': len(rows), 'archive': str(archive),
                      'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
