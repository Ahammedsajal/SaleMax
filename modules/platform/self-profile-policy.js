'use strict';
function isSelfProfileRequest(req,sourceTable){
  return String(req.baseUrl||'').replace(/\/$/,'')==='/api/user'&&
    String(req.path||'').toLowerCase()==='/update_profile'&&
    String(req.method||'').toUpperCase()==='POST'&&['user','agents'].includes(sourceTable);
}
module.exports={isSelfProfileRequest};
