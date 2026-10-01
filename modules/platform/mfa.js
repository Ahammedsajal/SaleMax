const crypto=require('node:crypto');
const {loadSession}=require('./sessions');
function fail(code){throw Object.assign(new Error(code),{code});}
function base32(bytes){let acc=0,bits=0,result='';const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';for(const byte of bytes){acc=(acc<<8)|byte;bits+=8;while(bits>=5){bits-=5;result+=alphabet[(acc>>>bits)&31];}acc&=(1<<bits)-1;}if(bits)result+=alphabet[(acc<<(5-bits))&31];return result;}
function totp(secret,counter,digits=6){
  const moving=Buffer.alloc(8);moving.writeBigUInt64BE(BigInt(counter));
  const hash=crypto.createHmac('sha1',secret).update(moving).digest(),offset=hash.at(-1)&15;
  return String((hash.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');
}
function match(secret,code,counter,last){
  if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;
  for(const step of [counter,counter-1,counter+1])if(step>=0&&step>last&&crypto.timingSafeEqual(Buffer.from(totp(secret,step)),Buffer.from(code)))return step;
  return null;
}
function createMfa({key}){
  if(!Buffer.isBuffer(key)||key.length<32)fail('AUTH_KEY_REQUIRED');
  const encryption=Buffer.from(crypto.hkdfSync('sha256',key,Buffer.alloc(0),'salemax-mfa-encryption-v1',32));
  const recoveryKey=Buffer.from(crypto.hkdfSync('sha256',key,Buffer.alloc(0),'salemax-mfa-recovery-v1',32));
  const recoveryHash=(id,code)=>crypto.createHmac('sha256',recoveryKey).update(id+':'+code).digest('hex');
  async function context(db,raw){
    const session=await loadSession(db,raw,{forUpdate:true});
    if(!session||session.audience!=='platform'||!session.recentlyAuthenticated)fail('REAUTH_REQUIRED');
    return session;
  }
  async function begin(db,raw){
    await db.beginTransaction();
    try{
      const ctx=await context(db,raw),id=ctx.identity.id;
      const [[old]]=await db.query('SELECT enrolled_at FROM sx_mfa_credentials WHERE identity_id=? FOR UPDATE',[id]);
      if(old?.enrolled_at)fail('MFA_ALREADY_ENROLLED');
      const secret=crypto.randomBytes(20),nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryption,nonce);
      cipher.setAAD(Buffer.from(id));const encrypted=Buffer.concat([cipher.update(secret),cipher.final()]),tag=cipher.getAuthTag();
      await db.query(`INSERT INTO sx_mfa_credentials(identity_id,secret_encrypted,nonce,auth_tag,window_end)
        VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE)) ON DUPLICATE KEY UPDATE secret_encrypted=VALUES(secret_encrypted),nonce=VALUES(nonce),auth_tag=VALUES(auth_tag)`,[id,encrypted,nonce,tag]);
      await db.commit();const encoded=base32(secret);
      return {secret:encoded,uri:'otpauth://totp/'+encodeURIComponent('SaleMaX:'+ctx.identity.displayName)+'?'+new URLSearchParams({secret:encoded,issuer:'SaleMaX',algorithm:'SHA1',digits:'6',period:'30'}),enrolled:false};
    }catch(error){await db.rollback();throw error;}
  }
  async function verify(db,raw,{code,recoveryCode}={}){
    await db.beginTransaction();
    let outcome;
    try{
      const ctx=await context(db,raw),id=ctx.identity.id;
      const [[row]]=await db.query(`SELECT *,FLOOR(TIMESTAMPDIFF(SECOND,'1970-01-01',UTC_TIMESTAMP(3))/30) AS counter,(window_end>UTC_TIMESTAMP(3)) AS current_window FROM sx_mfa_credentials WHERE identity_id=? FOR UPDATE`,[id]);
      if(!row)fail('MFA_NOT_ENROLLED');
      const attempts=row.current_window?row.attempts+1:1;
      await db.query(`UPDATE sx_mfa_credentials SET attempts=?,window_end=CASE WHEN window_end>UTC_TIMESTAMP(3) THEN window_end ELSE DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE) END WHERE identity_id=?`,[attempts,id]);
      if(attempts>8)outcome={error:'MFA_RATE_LIMITED'};
      else{
        let valid=false,step=null;
        if(typeof recoveryCode==='string'&&/^[A-Za-z0-9_-]{22}$/.test(recoveryCode)&&row.enrolled_at){
          const [used]=await db.query('UPDATE sx_mfa_recovery SET used_at=UTC_TIMESTAMP(3) WHERE identity_id=? AND code_hash=? AND used_at IS NULL',[id,recoveryHash(id,recoveryCode)]);valid=used.affectedRows===1;
        }else if(recoveryCode==null){
          const decipher=crypto.createDecipheriv('aes-256-gcm',encryption,row.nonce);decipher.setAAD(Buffer.from(id));decipher.setAuthTag(row.auth_tag);
          const secret=Buffer.concat([decipher.update(row.secret_encrypted),decipher.final()]);
          step=match(secret,code,Number(row.counter),Number(row.last_counter));valid=step!==null;
        }
        if(!valid)outcome={error:'MFA_INVALID'};
        else{
          let recoveryCodes;
          if(!row.enrolled_at){
            recoveryCodes=Array.from({length:10},()=>crypto.randomBytes(16).toString('base64url'));
            for(const value of recoveryCodes)await db.query('INSERT INTO sx_mfa_recovery(identity_id,code_hash) VALUES (?,?)',[id,recoveryHash(id,value)]);
          }
          await db.query('UPDATE sx_mfa_credentials SET enrolled_at=COALESCE(enrolled_at,UTC_TIMESTAMP(3)),last_counter=COALESCE(?,last_counter),attempts=0 WHERE identity_id=?',[step,id]);
          const [updated]=await db.query(`UPDATE sx_sessions SET mfa_verified_at=UTC_TIMESTAMP(3),expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 8 HOUR)
            WHERE id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(3)`,[ctx.sessionId]);
          if(updated.affectedRows!==1)fail('REAUTH_REQUIRED');
          await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
            VALUES (?,?,'identity','session.mfa-verified','session',?,?,?)`,[crypto.randomUUID(),id,ctx.sessionId,JSON.stringify({enrollment:!row.enrolled_at,recovery:recoveryCode!=null}),crypto.randomUUID()]);
          outcome={verified:true,...(recoveryCodes?{recoveryCodes}:{})};
        }
      }
      await db.commit();
    }catch(error){await db.rollback();throw error;}
    if(outcome.error)fail(outcome.error);return outcome;
  }
  return {begin,verify};
}
module.exports={createMfa,totp,base32};
