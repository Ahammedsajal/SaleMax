"""Guarded enable/restore of the Pro Catalyst test-audience pilot flag."""
import json
import os
from pathlib import Path
import subprocess
import sys

APP = 'salemax-app-1'
TENANT = '2301ea04-8acd-493e-a582-b9e527294005'
PROFILE = '51f11d68-1b77-4d73-9d28-96e36a80631f'
EXPECTED_RUNTIME = '0afa9ecc64ed6c6af092ad6e6fabaa7440b343b6602b655badc74b952cd5e14d'
EXPECTED_PLANNER = '0171a6bde053f78e101867de1c3d1fa55a788c936c0b163b656cea0b163019bb'
ROOT = Path('/opt/salemax/shared')

NODE = r'''(async()=>{
 const mysql=require('/app/node_modules/mysql2/promise');
 const db=await mysql.createConnection({host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});
 const [mode, tenant, profile, expected]=process.argv.slice(2);
 try {
  await db.beginTransaction();
  const [rows]=await db.query("SELECT revision,config,status,engine FROM sx_chatbot_profiles WHERE tenant_id=? AND id=? FOR UPDATE",[tenant,profile]);
  if(rows.length!==1) throw Error('PROFILE_NOT_UNIQUE');
  const row=rows[0], c=typeof row.config==='string'?JSON.parse(row.config):row.config;
  const has=Object.prototype.hasOwnProperty.call(c,'contextualAiPilot');
  const prev=has?c.contextualAiPilot:null;
  const test=Array.isArray(c.testRecipientPhones)?c.testRecipientPhones:[];
  const allowed=Array.isArray(c.allowedRecipientPhones)?c.allowedRecipientPhones:[];
  const approved=test.filter(phone=>allowed.includes(phone));
  if(row.status!=='live'||row.engine!=='hybrid'||c.aiFallback!==true||c.aiDataProcessingConfirmed!==true) throw Error('PROFILE_NOT_ELIGIBLE');
  if(!approved.length || !approved.some(phone=>String(phone).endsWith('55160323'))) throw Error('APPROVED_TEST_AUDIENCE_MISSING');
  if(mode==='inspect') {
    await db.rollback();console.log(JSON.stringify({revision:row.revision,priorPresent:has,priorValue:prev,approvedCount:approved.length}));return;
  }
  if(Number(row.revision)!==Number(expected)) throw Error('PROFILE_REVISION_CHANGED');
  if(mode==='enable' && (has && prev!==false)) throw Error('PILOT_NOT_DISABLED');
  if(mode==='restore' && prev!==true) throw Error('PILOT_NO_LONGER_ENABLED');
  let expr,params;
  if(mode==='enable'){expr="JSON_SET(config,'$.contextualAiPilot',JSON_EXTRACT('true','$'))";params=[];}
  else if(mode==='restore'&&process.argv[6]==='false'){expr="JSON_SET(config,'$.contextualAiPilot',JSON_EXTRACT('false','$'))";params=[];}
  else if(mode==='restore'&&process.argv[6]==='absent'){expr="JSON_REMOVE(config,'$.contextualAiPilot')";params=[];}
  else throw Error('INVALID_MODE');
  const [result]=await db.query(`UPDATE sx_chatbot_profiles SET config=${expr},revision=revision+1 WHERE tenant_id=? AND id=? AND revision=?`,[...params,tenant,profile,expected]);
  if(result.affectedRows!==1)throw Error('PROFILE_UPDATE_FAILED');
  await db.commit();console.log(JSON.stringify({mode,revision:Number(row.revision)+1,approvedCount:approved.length}));
 } catch(e){await db.rollback().catch(()=>{});console.error(e.code||e.message||'PILOT_CHANGE_FAILED');process.exitCode=1;}
 finally{await db.end();}
})().catch(e=>{console.error(e.code||'PILOT_CHANGE_FAILED');process.exit(1)});'''


def run(*args, input_text=None):
    result = subprocess.run(args, input=input_text, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def require_guard():
    if os.geteuid() != 0 or os.environ.get('SALEMAX_DEPLOY_LOCK_HELD') != '1':
        raise RuntimeError('protected production lock required')
    if run('hostname') != 'carsqatar-prod-01':
        raise RuntimeError('unexpected production host')
    for path, digest in [('chatbot-runtime.js', EXPECTED_RUNTIME), ('chatbot-turn-understanding.js', EXPECTED_PLANNER)]:
        actual = run('docker', 'exec', APP, 'sha256sum', '/app/modules/platform/' + path).split()[0]
        if actual != digest:
            raise RuntimeError('runtime changed before profile update')


def db(mode, revision='0', previous='absent'):
    output = run('docker', 'exec', '-i', APP, 'node', '-', mode, TENANT, PROFILE, str(revision), previous, input_text=NODE)
    return json.loads(output.splitlines()[-1])


def enable(backup):
    require_guard()
    if not backup.is_dir() or not str(backup.resolve()).startswith(str(ROOT.resolve()) + '/'):
        raise RuntimeError('expected protected release backup')
    before = db('inspect')
    if before['priorPresent'] and before['priorValue'] is not False:
        raise RuntimeError('pilot must be absent or disabled')
    snapshot = backup / 'contextual-pilot-before.json'
    if snapshot.exists():
        raise RuntimeError('pilot snapshot already exists')
    fd = os.open(snapshot, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(before, handle)
    result = db('enable', before['revision'])
    (backup / 'contextual-pilot-after.json').write_text(json.dumps(result) + '\n')
    print(json.dumps(result))


def restore(backup):
    require_guard()
    before = json.loads((backup / 'contextual-pilot-before.json').read_text())
    after = json.loads((backup / 'contextual-pilot-after.json').read_text())
    previous = 'false' if before['priorPresent'] else 'absent'
    print(json.dumps(db('restore', after['revision'], previous)))


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] not in ('enable', 'restore'):
        raise SystemExit('usage: pro-catalyst-contextual-pilot.py enable|restore <backup>')
    (enable if sys.argv[1] == 'enable' else restore)(Path(sys.argv[2]))
