const assert = require('node:assert/strict');
const fs = require('node:fs');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
(async () => {
  const c = await mysql.createConnection({host:process.env.DBHOST,port:process.env.DBPORT,user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});
  try {
    const expected = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const [tables] = await c.query('SHOW TABLES');
    assert.equal(tables.length, Object.keys(expected).length);
    let rows = 0;
    for (const [table,n] of Object.entries(expected)) {
      const [actual] = await c.query('SELECT COUNT(*) n FROM `'+table.replaceAll('`','``')+'`');
      assert.equal(Number(actual[0].n),n,'Row count mismatch: '+table);
      rows += n;
    }
    const [admins] = await c.query('SELECT email,password,role FROM admin LIMIT 1');
    assert.equal(admins[0].role,'admin');
    const token = jwt.sign({email:admins[0].email,password:admins[0].password,role:'admin'},process.env.JWTKEY);
    const authorized = await fetch('http://127.0.0.1:3010/api/admin/get_users',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
    assert.equal(authorized.success,true);
    const unauthorized = await fetch('http://127.0.0.1:3010/api/admin/get_users').then(r=>r.json());
    assert.equal(unauthorized.logout,true);
    const invalidLogin = await fetch('http://127.0.0.1:3010/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'deployment-check@example.invalid',password:'invalid'})}).then(r=>r.json());
    assert.equal(Boolean(invalidLogin.success),false);
    const disabledSSO = await fetch('http://127.0.0.1:3010/sso/node/start',{method:'POST'});
    assert.equal(disabledSSO.status,503);
    console.log(JSON.stringify({tablesVerified:tables.length,rowsVerified:rows,authenticatedAdminRead:true,unauthenticatedReadRejected:true,invalidLoginRejected:true,oldCrmSSODisabled:true,providersDisabled:process.env.LOCAL_ONLY_MODE==='true'}));
  } finally { await c.end(); }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
