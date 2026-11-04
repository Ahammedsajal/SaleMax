"""App-only AI integrations overlay. Run on the authorized host under its lock.

Usage: deploy-ai-integrations.py <stage> <release-name> <source-commit> <prior-vars>
The stage contains runtime files plus manifest.json with expected live hashes.
Rollback retains the additive usage migration and all later customer writes.
"""
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import time

APP = 'salemax-app-1'
BASE = Path('/opt/salemax')
SUPPORT = ['salemax-db-1', 'salemax-report-worker-1', 'salemax-recruitment-founder-notification-worker-1', 'salemax-libretranslate-1', 'salemax-bot-lead-test-db']


def run(args, env=None):
    result = subprocess.run(args, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Operation failed: ' + args[0])
    return result.stdout


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


def write(path, value):
    path.write_text(value)
    path.chmod(0o600)


def compose(snapshot, files):
    before = json.loads((snapshot / 'app-before.json').read_text())
    args = ['docker', 'compose', '--project-directory', before['Config']['Labels']['com.docker.compose.project.working_dir'], '-p', 'salemax',
            '--env-file', str(BASE / 'shared/stack.env'), '--env-file', str(BASE / 'shared/runtime.env'), '--env-file', str(snapshot / 'compose-values.env')]
    for file in files:
        args += ['-f', file]
    return args


def healthy():
    for _ in range(40):
        state = inspect(APP)
        if state['State'].get('Health', {}).get('Status') == 'healthy':
            return state
        time.sleep(2)
    raise RuntimeError('App health did not become healthy')


def restore(snapshot):
    expected = (snapshot / 'candidate-overlay.txt').read_text().strip()
    current = inspect(APP)['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    if current[-1] != expected or str((BASE / 'current').resolve()) != (snapshot / 'base-release.txt').read_text().strip():
        raise RuntimeError('A later release is active; review rollback manually')
    files = json.loads((snapshot / 'compose-before.json').read_text())
    run(compose(snapshot, files) + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app'])
    healthy()
    print('App rollback verified; additive usage columns retained')


def main():
    if run(['hostname']).strip() != 'carsqatar-prod-01' or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('Authorized host and production lock required')
    os.umask(0o077)
    if sys.argv[1] == '--rollback':
        restore(Path(sys.argv[2]))
        return
    stage, name, commit, prior_vars = sys.argv[1:]
    if not name.startswith('ai-integrations-') or '/' in name:
        raise RuntimeError('Invalid release name')
    stage = Path(stage)
    manifest = json.loads((stage / 'manifest.json').read_text())
    before = inspect(APP)
    if before['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Current app must be healthy')
    release, snapshot = BASE / 'releases' / name, BASE / 'shared' / ('rollback-' + name)
    release.mkdir(mode=0o755)
    snapshot.mkdir(mode=0o700)
    files = before['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    write(snapshot / 'app-before.json', json.dumps(before))
    write(snapshot / 'compose-before.json', json.dumps(files))
    write(snapshot / 'base-release.txt', str((BASE / 'current').resolve()))
    support = {name: inspect(name)['Id'] for name in SUPPORT}
    write(snapshot / 'support-before.json', json.dumps(support))
    values = Path(prior_vars).read_text()
    variable_suffix = re.sub(r'[^A-Za-z0-9]', '_', name).upper()
    release_variable = f'SALEMAX_{variable_suffix}_RELEASE'
    image_variable = f'SALEMAX_{variable_suffix}_BASE_IMAGE'
    values += f'\n{release_variable}={release}\n{image_variable}={before["Image"]}\n'
    # The prior snapshot predates the last grounded-delivery override.
    if 'SALEMAX_PROCATALYST_GROUNDED_DELIVERY_RELEASE=' not in values:
        values += 'SALEMAX_PROCATALYST_GROUNDED_DELIVERY_RELEASE=/opt/salemax/releases/procatalyst-grounded-delivery-a7ce2406-20261102\n'
    # Recover release paths omitted from an older deployment's variable file.
    # Preflight below still compares every unrelated mount against the live app.
    known = {line.split('=', 1)[0] for line in values.splitlines() if '=' in line}
    for file in files:
        owner = Path(file).parent
        if owner.name == 'deploy':
            owner = owner.parent
        for variable in re.findall(r'\$\{(SALEMAX_[A-Z0-9_]+_RELEASE)(?=[:}])', Path(file).read_text()):
            if variable not in known:
                values += f'{variable}={owner}\n'
                known.add(variable)
    write(snapshot / 'compose-values.env', values)
    overrides = []
    for relative, expected in manifest['files'].items():
        target = '/app/' + relative
        if expected:
            live = run(['docker', 'exec', APP, 'sha256sum', target]).split()[0]
            if live != expected:
                raise RuntimeError('Live source changed: ' + relative)
            old = snapshot / 'preimages' / relative
            old.parent.mkdir(parents=True, exist_ok=True)
            run(['docker', 'cp', APP + ':' + target, str(old)])
        else:
            exists = subprocess.run(['docker', 'exec', APP, 'test', '-e', target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
            if exists == 0:
                raise RuntimeError('Unexpected existing runtime file: ' + relative)
        source = stage / 'runtime' / relative
        candidate = release / 'runtime' / relative
        candidate.parent.mkdir(parents=True, exist_ok=True)
        candidate.write_bytes(source.read_bytes())
        candidate.chmod(0o444)
        overrides.append(f'      - ${{{release_variable}:?}}/runtime/{relative}:{target}:ro')
    overlay = release / 'compose.ai-integrations.override.yml'
    overlay.write_text(f'services:\n  app:\n    image: ${{{image_variable}:?}}\n    volumes:\n' + '\n'.join(overrides) + '\n')
    overlay.chmod(0o444)
    write(snapshot / 'candidate-overlay.txt', str(overlay))
    own = Path(__file__).read_text()
    write(snapshot / 'restore.py', own)
    write(snapshot / 'restore.sh', '#!/bin/sh\nset -eu\nexec python3 "' + str(snapshot / 'restore.py') + '" --rollback "' + str(snapshot) + '"\n')
    (snapshot / 'restore.sh').chmod(0o700)
    candidate_files = files + [str(overlay)]
    config = json.loads(run(compose(snapshot, candidate_files) + ['config', '--format', 'json']))
    write(snapshot / 'candidate-config.json', json.dumps(config))
    mounts = {item['Destination']: item['Source'] for item in before['Mounts']}
    proposed = {item['target']: item['source'] for item in config['services']['app'].get('volumes', [])}
    allowed = {'/app/' + item for item in manifest['files']}
    if any(proposed.get(target) != source for target, source in mounts.items() if target not in allowed):
        raise RuntimeError('Unrelated app mount changed')
    if set(proposed) != set(mounts) | allowed:
        raise RuntimeError('Unexpected app mount destinations')
    if config['services']['app']['image'] != before['Image']:
        raise RuntimeError('App image drift')
    # Apply only this reviewed additive migration through the existing ledger.
    migration = manifest['migration']
    run(['docker', 'cp', str(stage / 'runtime' / ('database/migrations/' + migration)), APP + ':/tmp/' + migration])
    code = "const fs=require('fs');const {applyMigrations,splitSql,discover}=require('./database/migration-runner');const c=require('crypto');const p='/tmp/" + migration + "';const sql=fs.readFileSync(p,'utf8');const pool=require('./database/config');(async()=>{const db=await pool.promise().getConnection();try{await applyMigrations(db,[...discover('/app/database/migrations'),{file:'" + migration + "',checksum:c.createHash('sha256').update(sql).digest('hex'),statements:splitSql(sql)}],{only:'" + migration + "'});}finally{db.release();await pool.promise().end();}})().catch(()=>process.exit(1));"
    run(['docker', 'exec', '-w', '/app', APP, 'node', '-e', code])
    changed = False
    try:
        changed = True
        run(compose(snapshot, candidate_files) + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app'])
        after = healthy()
        if after['Image'] != before['Image'] or after['RestartCount'] != 0:
            raise RuntimeError('App identity or restart mismatch')
        for relative in manifest['files']:
            expected = hashlib.sha256((release / 'runtime' / relative).read_bytes()).hexdigest()
            if run(['docker', 'exec', APP, 'sha256sum', '/app/' + relative]).split()[0] != expected:
                raise RuntimeError('Deployed hash mismatch')
            if relative.endswith('.js'):
                run(['docker', 'exec', APP, 'node', '--check', '/app/' + relative])
        if support != {name: inspect(name)['Id'] for name in SUPPORT}:
            raise RuntimeError('Support service changed')
        run(['curl', '-fsS', '--max-time', '15', 'https://7network.live/healthz'])
        write(release / 'RELEASE.json', json.dumps({'sourceCommit': commit, 'image': after['Image'], 'migration': migration, 'rollback': str(snapshot), 'files': list(manifest['files'])}, indent=2))
        print(json.dumps({'verified': True, 'release': str(release), 'image': after['Image'], 'composeInputs': len(candidate_files), 'rollback': str(snapshot), 'files': len(manifest['files']), 'supportServicesUnchanged': True}))
    except Exception:
        if changed:
            run(compose(snapshot, files) + ['up', '-d', '--no-deps', '--no-build', '--force-recreate', 'app'])
            healthy()
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
