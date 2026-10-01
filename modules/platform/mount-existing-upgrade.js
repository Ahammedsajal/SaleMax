const {createAuthRouter}=require('./auth-router');
const {createExistingCatalogueRouter}=require('./existing-catalogue-router');
const {createExistingBusinessRouter}=require('./existing-business-router');
const {createExistingPlatformAccessRouters}=require('./existing-platform-access-router');
const {createTeamInvitationRouters}=require('./team-invitation-router');
function mountExistingUpgrade(app,{pool,key,origin,insecureLoopback=false,legacyGuard,userGuard=require('../../middlewares/user')}){
  const boundary=createAuthRouter({pool,key,origin,insecureLoopback});
  // Existing /admin panel only: no separate catalogue, login page or application shell.
  app.use('/api/admin/platform-auth',legacyGuard,boundary.router);
  app.use('/api/admin/plan-contracts',createExistingCatalogueRouter({pool,legacyGuard,canonicalGuard:boundary.guard}));
  app.use('/api/admin/business-contracts',createExistingBusinessRouter({pool,legacyGuard,canonicalGuard:boundary.guard}));
  const access=createExistingPlatformAccessRouters({pool,origin});
  app.use('/api/admin/platform-access',legacyGuard,boundary.guard,access.admin);
  app.use('/api/admin/staff-invitations',access.accept);
  const team=createTeamInvitationRouters({pool,origin,userGuard});
  app.use('/api/user/team-invitations',team.owner);
  app.use('/api/agent/invitations',team.accept);
  return boundary;
}
function mountConfiguredUpgrade(app){
  if(process.env.SALEMAX_PLATFORM_ENABLED!=='true'){app.use(['/api/admin/platform-auth','/api/admin/plan-contracts','/api/admin/business-contracts','/api/admin/platform-access','/api/admin/staff-invitations','/api/user/team-invitations','/api/agent/invitations'],(req,res)=>res.status(503).json({code:'PLATFORM_UPGRADE_NOT_ENABLED'}));return false;}
  const secret=process.env.SALEMAX_PLATFORM_KEY_BASE64;
  if(typeof secret!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(secret))throw new Error('PLATFORM_KEY_REQUIRED');
  const key=Buffer.from(secret,'base64');if(key.length!==32||key.toString('base64')!==secret)throw new Error('PLATFORM_KEY_INVALID');
  const local=process.env.LOCAL_ONLY_MODE==='true';
  mountExistingUpgrade(app,{pool:require('../../database/config').promise(),key,origin:process.env.SALEMAX_PLATFORM_ORIGIN,insecureLoopback:local,legacyGuard:require('../../middlewares/admin')});
  return true;
}
module.exports={mountExistingUpgrade,mountConfiguredUpgrade};
