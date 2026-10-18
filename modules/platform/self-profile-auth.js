'use strict';

const jwt=require('jsonwebtoken');

function createSelfProfileAuth({verify=jwt.verify,userGuard,agentGuard}={}){
  userGuard=userGuard||require('../../middlewares/user');
  agentGuard=agentGuard||require('../../middlewares/agent');
  return function selfProfileAuth(req,res,next){
    const header=req.get('Authorization')||'';
    const match=header.match(/^Bearer\s+(\S+)$/i);
    if(!match)return res.status(401).json({success:false,logout:true,msg:'Sign in to update your profile.'});
    let claims;
    try{claims=verify(match[1],process.env.JWTKEY);}catch(_){return res.status(401).json({success:false,logout:true,msg:'Your session is no longer valid. Sign in again.'});}
    if(claims?.role==='agent')return agentGuard(req,res,next);
    if(claims?.role==='user')return userGuard(req,res,next);
    return res.status(403).json({success:false,msg:'This account cannot update a business profile.'});
  };
}

module.exports={createSelfProfileAuth};
