'use strict';
function matches(req,platformOrigin){if(req.crmTenantDomain)return req.get('Origin')===`https://${req.crmTenantDomain.hostname}`;return req.get('Origin')===platformOrigin;}
module.exports={matches};
