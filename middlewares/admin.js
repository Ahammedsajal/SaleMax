const jwt=require('jsonwebtoken');
const {createLegacyAdminStaffBoundary}=require('../modules/platform/legacy-admin-staff-boundary');
function createAdminValidator(runQuery,key){
  const staffBoundary=createLegacyAdminStaffBoundary(runQuery);
  return async(req,res,next)=>{
    const authorization=req.get('Authorization');
    if(typeof authorization!=='string'||!/^Bearer \S+$/.test(authorization))return res.json({success:false,msg:'Administrator sign-in is required',logout:true});
    try{
      const decode=jwt.verify(authorization.slice(7),typeof key==='function'?key():key);
      if(!decode||typeof decode.email!=='string'||typeof decode.password!=='string'||typeof decode.uid!=='string')return res.json({success:false,msg:'Invalid token found',logout:true});
      const rows=await runQuery('SELECT id,uid,role FROM admin WHERE email=? AND password=? AND uid=?',[decode.email,decode.password,decode.uid]);
      if(rows.length!==1||rows[0].uid!==decode.uid||rows[0].role!=='admin')return res.json({success:false,msg:'Unauthorized token',logout:true});
      const access=await staffBoundary({adminId:rows[0].id,uid:decode.uid,method:req.method,path:req.originalUrl||req.baseUrl+req.path});
      if(!access.allowed)return res.status(403).json({success:false,code:access.code});
      req.decode=decode;req.legacyAdminId=rows[0].id;req.platformAccess=access.platform||null;next();
    }catch(_){return res.json({success:false,msg:'Administrator session could not be verified',logout:true});}
  };
}
module.exports=createAdminValidator((sql,args)=>require('../database/dbpromise').query(sql,args),()=>process.env.JWTKEY);
module.exports.createAdminValidator=createAdminValidator;
