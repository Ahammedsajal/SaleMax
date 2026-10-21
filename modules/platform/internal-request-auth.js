'use strict';

const {timingSafeEqual}=require('node:crypto');

function matchesSecret(candidate,expected){
  if(typeof candidate!=='string'||typeof expected!=='string'||!candidate||!expected)return false;
  const supplied=Buffer.from(candidate),configured=Buffer.from(expected);
  return supplied.length===configured.length&&timingSafeEqual(supplied,configured);
}

function isAuthorizedInternalRequest(req,env=process.env){
  const expected=String(env.CRM_INTERNAL_SECRET||'').trim();
  if(!expected)return false;
  const header=String(req?.get?.('x-internal-secret')||'').trim();
  if(matchesSecret(header,expected))return true;
  const authorization=String(req?.get?.('Authorization')||'').trim();
  if(!/^Bearer\s+/i.test(authorization))return false;
  return matchesSecret(authorization.replace(/^Bearer\s+/i,'').trim(),expected);
}

function requireInternalAuth(req,res,next){
  if(!isAuthorizedInternalRequest(req))return res.status(401).json({success:false,msg:'Unauthorized internal request'});
  return next();
}

module.exports={matchesSecret,isAuthorizedInternalRequest,requireInternalAuth};
