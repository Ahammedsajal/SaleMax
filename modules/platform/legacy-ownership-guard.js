'use strict';
const fail=code=>{throw Object.assign(new Error(code),{code});};
// Caller owns the user-row transaction. Future adoption must acquire that same
// row lock before adding its reviewed mapping. No email-based owner inference.
async function requireUnmapped(db,userId){
  const [tables]=await db.query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_legacy_ownership'");
  if(!tables.length)return; // Compatible with the pre-upgrade database.
  if(tables[0].ENGINE!=='InnoDB')fail('ASSIGNMENT_STORAGE_NOT_READY');
  const [mapped]=await db.query("SELECT tenant_id FROM sx_legacy_ownership WHERE source_table='user' AND source_id=? FOR UPDATE",[String(userId)]);
  if(mapped.length)fail('CANONICAL_ASSIGNMENT_REQUIRED');
}
async function writeUnmapped(db,{uid,plan,expiresAt}){
  if(typeof uid!=='string'||!uid||uid!==uid.trim()||uid.length>999||!plan||typeof plan!=='object'||Array.isArray(plan)||!Number.isSafeInteger(expiresAt))fail('INVALID_ASSIGNMENT');
  const [tables]=await db.query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user'");
  if(tables.length!==1||tables[0].ENGINE!=='InnoDB')fail('ASSIGNMENT_STORAGE_NOT_READY');
  await db.beginTransaction();
  try{
    const [users]=await db.query('SELECT id,uid FROM user WHERE uid=? FOR UPDATE',[uid]);
    if(!users.length||users[0].uid!==uid)fail('USER_NOT_FOUND');
    if(users.length!==1)fail('AMBIGUOUS_USER');
    await requireUnmapped(db,users[0].id);
    const [updated]=await db.query('UPDATE user SET plan=?,plan_expire=? WHERE id=?',[JSON.stringify(plan),expiresAt,users[0].id]);
    if(updated.affectedRows!==1)fail('ASSIGNMENT_WRITE_FAILED');
    await db.commit();
  }catch(error){await db.rollback();throw error;}
}
module.exports={requireUnmapped,writeUnmapped};
