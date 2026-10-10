const {createAuthRouter}=require('./auth-router');
const {createExistingCatalogueRouter}=require('./existing-catalogue-router');
const {createExistingBusinessRouter}=require('./existing-business-router');
const {createExistingPlatformAccessRouters}=require('./existing-platform-access-router');
const {createTeamInvitationRouters}=require('./team-invitation-router');
const {createTrainingCourseRouter}=require('./training-course-router');
const {createTrainingCenterProfileRouter}=require('./training-center-profile-router');
const {createTrainingFinanceRouter,createPublicTrainingDocumentRouter,createPublicTrainingReminderRouter}=require('./training-finance-router');
const {createTrainingStudentsRouter}=require('./training-students-router');
const {createTrainingFormRouter,createPublicTrainingFormRouter}=require('./training-form-router');
const {createChatbotRouter}=require('./chatbot-router');
const {createAsteriskRouter}=require('./asterisk-router');
const {createCallCenterRouter}=require('./call-center-router');
const {createTaskRouter}=require('./task-router');
const {createTaskContext}=require('./training-task-context');
const {createTenantCrmRouter}=require('./tenant-crm-router');
function mountExistingUpgrade(app,{pool,key,origin,insecureLoopback=false,legacyGuard,userGuard=require('../../middlewares/user')}){
  const tenantCrmDomains=require('./tenant-crm-domains');
  app.use(tenantCrmDomains.middleware(pool));
  const boundary=createAuthRouter({pool,key,origin,insecureLoopback,allowedAudience:'platform'});
  const businessBoundary=createAuthRouter({pool,key,origin,insecureLoopback,allowedAudience:'tenant'});
  // Existing /admin panel only: no separate catalogue, login page or application shell.
  app.use('/api/admin/platform-auth',legacyGuard,boundary.router);
  // Business sessions use the existing /user API surface and never accept the
  // separate platform-admin audience.
  app.use('/api/user/business-auth',businessBoundary.router);
  app.use('/api/crm',createTenantCrmRouter({pool,canonicalGuard:businessBoundary.guard}));
  app.use('/api/admin/plan-contracts',createExistingCatalogueRouter({pool,legacyGuard,canonicalGuard:boundary.guard}));
  app.use('/api/admin/business-contracts',createExistingBusinessRouter({pool,legacyGuard,canonicalGuard:boundary.guard}));
  const access=createExistingPlatformAccessRouters({pool,origin});
  app.use('/api/admin/platform-access',legacyGuard,boundary.guard,access.admin);
  app.use('/api/admin/asterisk',legacyGuard,boundary.guard,createAsteriskRouter({pool}));
  app.use('/api/admin/staff-invitations',access.accept);
  const team=createTeamInvitationRouters({pool,origin,userGuard,insecureLoopback});
  app.use('/api/user/team-invitations',team.owner);
  app.use('/api/agent/invitations',team.accept);
  app.use('/api/user/training/courses',createTrainingCourseRouter({pool,origin,userGuard,canonicalGuard:businessBoundary.guard}));
  app.use('/api/user/training/tasks',businessBoundary.guard,createTaskRouter({pool,contextFor:(req,permission)=>createTaskContext(pool,req.businessContext,permission)}));
  app.use('/api/user/training/students',createTrainingStudentsRouter({pool,origin,userGuard,canonicalGuard:businessBoundary.guard}));
  app.use('/api/user/training/profile',createTrainingCenterProfileRouter({pool,origin,userGuard,canonicalGuard:businessBoundary.guard}));
  app.use('/api/user/training/finance-policies',createTrainingFinanceRouter({pool,origin,userGuard,canonicalGuard:businessBoundary.guard}));
  app.use('/api/public/training/documents',createPublicTrainingDocumentRouter({pool,origin}));
  app.get('/customer-document',(req,res)=>{res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");res.sendFile(require('node:path').resolve(__dirname,'../../client/public/customer-document.html'));});
  app.use('/api/public/training/reminder-preferences',createPublicTrainingReminderRouter({pool,origin}));
  app.get('/customer-reminders',(req,res)=>{res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");res.sendFile(require('node:path').resolve(__dirname,'../../client/public/customer-reminders.html'));});
  app.use('/api/user/training/forms',createTrainingFormRouter({pool,origin,userGuard}));
  app.use('/api/user/chatbots',createChatbotRouter({pool,origin,userGuard,canonicalGuard:businessBoundary.guard}));
  app.use('/api/user/call-center',createCallCenterRouter({pool,userGuard,canonicalGuard:businessBoundary.guard,origin}));
  app.use('/api/public/training/forms',createPublicTrainingFormRouter({app,pool,rateKey:key,origin}));
  return boundary;
}
function mountConfiguredUpgrade(app){
  if(process.env.SALEMAX_PLATFORM_ENABLED!=='true'){app.use(['/api/admin/platform-auth','/api/admin/plan-contracts','/api/admin/business-contracts','/api/admin/platform-access','/api/admin/asterisk','/api/admin/staff-invitations','/api/user/business-auth','/api/crm','/api/user/team-invitations','/api/user/training/courses','/api/user/training/tasks','/api/user/training/students','/api/user/training/profile','/api/user/training/finance-policies','/api/user/training/forms','/api/user/chatbots','/api/user/call-center','/api/public/training/forms','/api/public/training/documents','/api/public/training/reminder-preferences','/api/agent/invitations'],(req,res)=>res.status(503).json({code:'PLATFORM_UPGRADE_NOT_ENABLED'}));return false;}
  const secret=process.env.SALEMAX_PLATFORM_KEY_BASE64;
  if(typeof secret!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(secret))throw new Error('PLATFORM_KEY_REQUIRED');
  const key=Buffer.from(secret,'base64');if(key.length!==32||key.toString('base64')!==secret)throw new Error('PLATFORM_KEY_INVALID');
  const local=process.env.LOCAL_ONLY_MODE==='true';
  const origin=process.env.SALEMAX_PLATFORM_ORIGIN;
  const originUrl=new URL(origin);
  // Provider isolation does not make a publicly hosted app a loopback origin.
  const insecureLoopback=local&&originUrl.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(originUrl.hostname);
  mountExistingUpgrade(app,{pool:require('../../database/config').promise(),key,origin,insecureLoopback,legacyGuard:require('../../middlewares/admin')});
  return true;
}
module.exports={mountExistingUpgrade,mountConfiguredUpgrade};
