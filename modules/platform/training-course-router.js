'use strict';

const express = require('express');
const fileUpload = require('express-fileupload');
const fs = require('node:fs/promises');
const courses = require('./training-courses');
const courseMedia = require('./training-course-media');
const enrollmentProgress = require('./training-enrollment-progress');

function createTrainingCourseRouter({ pool, origin, userGuard, canonicalGuard }) {
  const router = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  let activeCourseUploads = 0;
  const withConnection = fn => async (...args) => {
    const db = await pool.getConnection();
    try { return await fn(db, ...args); }
    finally { db.release(); }
  };

  router.use(express.json({ limit: '24kb', strict: true }));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (!require('./request-origin').matches(req,origin)) return res.status(403).json({ success: false, code: 'ORIGIN_DENIED' });
    if (req.is('multipart/form-data')) return next();
    if (req.method === 'DELETE' && !req.body) return next();
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ success: false, code: 'INVALID_BODY' });
    return next();
  });

  // Short-lived signed stream URLs let native image/video elements request
  // byte ranges without exposing a long-lived business bearer token.
  router.get('/:courseId/media/:mediaId/stream', wrap(async (req, res) => {
    const cookieName = `sx_course_media_${req.params.mediaId.replace(/-/g, '')}`;
    const cookie = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='));
    const token = cookie?.slice(cookieName.length + 1);
    if (!token || token.length > 2048) throw Object.assign(new Error('COURSE_MEDIA_ACCESS_REQUIRED'), { code: 'COURSE_MEDIA_ACCESS_REQUIRED', status: 401 });
    const payload = courseMedia.verifyAccessToken(token);
    if (payload.courseId !== req.params.courseId || payload.mediaId !== req.params.mediaId) throw Object.assign(new Error('COURSE_MEDIA_ACCESS_REQUIRED'), { code: 'COURSE_MEDIA_ACCESS_REQUIRED', status: 401 });
    const db = await pool.getConnection();
    let file;
    try { file = await courseMedia.getFile(db, payload.tenantId, payload.courseId, payload.mediaId); }
    finally { db.release(); }
    await fs.access(file.path);
    const disposition = file.kind === 'document' ? 'attachment' : 'inline';
    const asciiName = file.originalName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(file.path, { dotfiles: 'deny', acceptRanges: true }, error => {
      if (error && !res.headersSent) res.status(error.statusCode || 404).json({ success: false, code: 'COURSE_MEDIA_NOT_FOUND' });
    });
  }));

  router.use((req, res, next) => {
    const authorization = req.get('Authorization') || '';
    if (/^Bearer\s+/i.test(authorization)) return userGuard(req, res, () => courses.legacyOwnerContext(pool, req.decode.uid).then(ctx => { req.courseContext = ctx; next(); }).catch(next));
    if (!canonicalGuard) return userGuard(req, res, () => courses.legacyOwnerContext(pool, req.decode.uid).then(ctx => { req.courseContext = ctx; next(); }).catch(next));
    return canonicalGuard(req, res, () => { req.courseContext = req.businessContext; next(); });
  });
  const contextGuard = (req, res, next) => req.courseContext ? next() : res.status(401).json({ success: false, code: 'AUTH_REQUIRED' });

  router.get('/', contextGuard, wrap(async (req, res) => res.json({ success: true, data: await courses.list(pool, req.courseContext, {
    page: req.query.page === undefined ? 1 : Number(req.query.page),
    limit: req.query.limit === undefined ? 20 : Number(req.query.limit),
    search: req.query.search || '', status: req.query.status || ''
  }) })));
  router.post('/import-procatalyst', contextGuard, wrap(async (req, res) => {
    const source=[
      ['PCAT-BARISTA','Barista Training','تدريب باريستا','This programme prepares you for professional work in cafés, restaurants, and hospitality outlets. You learn coffee origins, bean selection, grinding techniques, and espresso extraction. Training covers milk texturing, latte art basics, beverage presentation, hygiene standards, and customer service skills. You practise using commercial coffee machines and handle real service scenarios. After completion, you are ready to work confidently as a barista in fast paced environments.','يهيئك هذا البرنامج للعمل باحتراف في المقاهي والمطاعم ومرافق الضيافة. تتعلم أنواع القهوة واختيار الحبوب وتقنيات الطحن واستخلاص الإسبريسو. ويشمل التدريب تبخير الحليب وأساسيات فن اللاتيه وتقديم المشروبات ومعايير النظافة وخدمة العملاء، مع تطبيق عملي على آلات القهوة التجارية ومواقف الخدمة الواقعية.',['Art & Hobby','Health & Wellness','Personal Training']],
      ['PCAT-CAREGIVER','Certified Care Giver','مقدم رعاية معتمد','This programme focuses on compassionate care for elderly individuals and people with special needs. You learn daily living assistance, personal care routines, mobility support, nutrition guidance, and emotional support techniques. The course also covers safeguarding, hygiene, and communication with families. You graduate with the practical skills needed for home care, assisted living facilities, and community care roles.','يركز هذا البرنامج على رعاية كبار السن والأشخاص ذوي الاحتياجات الخاصة باهتمام. تتعلم المساعدة في الحياة اليومية والعناية الشخصية ودعم الحركة والإرشاد الغذائي وأساليب الدعم النفسي. كما يغطي الحماية والنظافة والتواصل مع الأسر، ويمنحك مهارات عملية للعمل في الرعاية المنزلية ومرافق المعيشة المدعومة وخدمات المجتمع.',['Health & Wellness','Personal Training','Teacher']],
      ['PCAT-MARINE-DECK','Certified Marine Deck Hand','مساعد سطح بحري معتمد','This programme prepares you for entry level maritime operations. You learn deck maintenance, safety procedures, rope handling, basic navigation support, and emergency response practices. The course includes maritime safety regulations and teamwork on board vessels. You develop practical skills required to support ship operations in ports, offshore services, and commercial marine environments.','يهيئك هذا البرنامج للبدء في العمليات البحرية. تتعلم صيانة السطح وإجراءات السلامة والتعامل مع الحبال ودعم الملاحة الأساسية والاستجابة للطوارئ. ويتناول لوائح السلامة البحرية والعمل الجماعي على متن السفن، مع تطوير المهارات العملية اللازمة لدعم عمليات السفن في الموانئ والخدمات البحرية والبيئات التجارية.',['Corporate Training','Personal Training','Safety Training']],
      ['PCAT-SEN-SHADOW','Special Education Needs and Shadow Teaching','الاحتياجات التعليمية الخاصة والتعليم الظلي','This training prepares you to support students with learning difficulties, developmental delays, or behavioural challenges. You learn inclusive teaching strategies, behaviour management techniques, and individual support planning. The programme includes shadow teaching skills, classroom observation, and collaboration with teachers and parents. You become equipped to assist learners in mainstream or specialised educational environments.','يهيئك هذا التدريب لدعم الطلاب ذوي صعوبات التعلم أو التأخر النمائي أو التحديات السلوكية. تتعلم استراتيجيات التعليم الدامج وإدارة السلوك وإعداد خطط الدعم الفردية. ويشمل مهارات التعليم الظلي وملاحظة الصف والتعاون مع المعلمين وأولياء الأمور لمساندة المتعلمين في البيئات التعليمية العامة أو المتخصصة.',['Health & Wellness','Safety Training','Teacher']],
      ['PCAT-GUEST-SERVICE','Certified Guest Service Pro','محترف خدمة ضيوف معتمد','This programme develops professional hospitality and customer service skills. You learn front desk operations, guest handling, service etiquette, complaint resolution, and communication excellence. The training focuses on service standards required in hotels, resorts, airlines, and high end service environments. You gain confidence to deliver consistent guest satisfaction and manage service challenges effectively.','يطور هذا البرنامج مهارات الضيافة وخدمة العملاء. تتعلم عمليات الاستقبال والتعامل مع الضيوف وآداب الخدمة وحل الشكاوى والتواصل المتميز. ويركز على معايير الخدمة في الفنادق والمنتجعات وشركات الطيران ومرافق الخدمة الراقية، لتقديم تجربة مرضية وإدارة تحديات الخدمة بفعالية.',['Business','Corporate Training','Personal Training']],
      ['PCAT-STERILIZATION','Certified Sterilization Technician','فني تعقيم معتمد','This course trains you in medical equipment sterilization and infection prevention protocols. You learn cleaning, disinfection, sterilization techniques, instrument handling, and storage standards used in healthcare facilities. The programme covers safety regulations, contamination control, and quality assurance procedures. You graduate ready to work in hospitals, clinics, laboratories, and surgical centres.','يدربك هذا البرنامج على تعقيم المعدات الطبية وبروتوكولات الوقاية من العدوى. تتعلم التنظيف والتطهير وتقنيات التعقيم والتعامل مع الأدوات ومعايير التخزين في مرافق الرعاية الصحية. كما يغطي لوائح السلامة ومكافحة التلوث وضمان الجودة، للعمل في المستشفيات والعيادات والمختبرات ومراكز الجراحة.',['Corporate Training','Personal Training','Safety Training']]
    ];
    const db=await pool.getConnection();try{const created=[],skipped=[];for(const [code,nameEn,nameAr,descriptionEn,descriptionAr,sourceCategories] of source){const [[existing]]=await db.query('SELECT id FROM sx_training_courses WHERE tenant_id=? AND code=?',[req.courseContext.tenant.id,code]);if(existing){skipped.push(code);continue;}try{const item=await courses.create(db,req.courseContext,{code,nameEn,nameAr,descriptionEn,descriptionAr,sourceCategories});created.push({code,id:item.id});}catch(error){if(error.code==='ER_DUP_ENTRY'){skipped.push(code);continue;}throw error;}}res.status(created.length?201:200).json({success:true,data:{created,skipped,total:source.length,priceAndDurationSet:false}});}finally{db.release();}
  }));
  router.get('/enrollments', contextGuard, wrap(async (req, res) => res.json({ success: true, data: await withConnection(enrollmentProgress.list)(req.courseContext, req.query) })));
  router.post('/enrollments/:id/progress', contextGuard, wrap(async (req, res) => res.json({ success: true, data: await withConnection(enrollmentProgress.transition)(req.courseContext, req.params.id, req.body) })));
  router.post('/', contextGuard, wrap(async (req, res) => res.status(201).json({ success: true, data: await withConnection(courses.create)(req.courseContext, req.body) })));
  router.put('/:id', contextGuard, wrap(async (req, res) => res.json({ success: true, data: await withConnection(courses.update)(req.courseContext, req.params.id, req.body.expectedRevision, req.body) })));
  router.get('/:id/media', contextGuard, wrap(async (req, res) => res.json({ success: true, data: await courseMedia.list(pool, req.courseContext, req.params.id) })));
  router.post('/:id/media', contextGuard, async (req, res, next) => {
    try {
      if (activeCourseUploads >= 1) return res.status(429).json({ success: false, code: 'COURSE_MEDIA_UPLOAD_BUSY' });
      activeCourseUploads++;
      let released = false;
      const release = () => { if (!released) { released = true; activeCourseUploads--; } };
      res.once('finish', release);
      res.once('close', release);
      await courseMedia.ensureDirectories();
      fileUpload({
        useTempFiles: true, tempFileDir: courseMedia.tempDirectory(), safeFileNames: true,
        limits: { fileSize: courseMedia.MAX_FILE_BYTES, files: 1 }, abortOnLimit: false
      })(req, res, next);
    } catch (error) { next(error); }
  }, wrap(async (req, res) => {
    const file = req.files?.file;
    if (!file || Array.isArray(file)) throw Object.assign(new Error('COURSE_MEDIA_FILE_REQUIRED'), { code: 'COURSE_MEDIA_FILE_REQUIRED' });
    try { res.status(201).json({ success: true, data: await withConnection(courseMedia.attach)(req.courseContext, req.params.id, file) }); }
    finally { if (file.tempFilePath) await fs.rm(file.tempFilePath, { force: true }).catch(() => {}); }
  }));
  router.get('/:id/media/:mediaId/access', contextGuard, wrap(async (req, res) => {
    courses.object(req.courseContext, 'courses.read');
    const db = await pool.getConnection();
    try { await courseMedia.getFile(db, req.courseContext.tenant.id, req.params.id, req.params.mediaId); }
    finally { db.release(); }
    const access = courseMedia.accessToken(req.courseContext, req.params.id, req.params.mediaId);
    const mediaPath = `${req.baseUrl}/${encodeURIComponent(req.params.id)}/media/${encodeURIComponent(req.params.mediaId)}/stream`;
    const cookieName = `sx_course_media_${req.params.mediaId.replace(/-/g, '')}`;
    const secure = origin.startsWith('https://') ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${cookieName}=${access}; Path=${mediaPath}; Max-Age=10800; HttpOnly; SameSite=Strict${secure}`);
    res.json({ success: true, data: { url: mediaPath, expiresInSeconds: 10800 } });
  }));
  router.delete('/:id/media/:mediaId', contextGuard, wrap(async (req, res) => res.json({ success: true, data: await withConnection(courseMedia.remove)(req.courseContext, req.params.id, req.params.mediaId) })));
  router.get('/:id/offers', contextGuard, wrap(async (req, res) => res.json({ success: true, data: await courses.offers(pool, req.courseContext, req.params.id) })));
  router.post('/:id/offers', contextGuard, wrap(async (req, res) => res.status(201).json({ success: true, data: await withConnection(courses.addOffer)(req.courseContext, req.params.id, req.body) })));
  router.get('/:id/batches', contextGuard, wrap(async (req, res) => res.json({ success: true, data: await courses.batches(pool, req.courseContext, req.params.id) })));
  router.post('/:id/batches', contextGuard, wrap(async (req, res) => res.status(201).json({ success: true, data: await withConnection(courses.addBatch)(req.courseContext, req.params.id, req.body) })));
  router.put('/:id/batches/:batchId', contextGuard, wrap(async (req, res) => res.json({ success: true, data: await withConnection(courses.updateBatch)(req.courseContext, req.params.id, req.params.batchId, req.body) })));
  router.post('/:id/publish', contextGuard, wrap(async (req, res) => res.json({ success: true, data: await withConnection(courses.publish)(req.courseContext, req.params.id, req.body.expectedRevision) })));
  router.post('/:id/retire', contextGuard, wrap(async (req, res) => res.json({ success: true, data: await withConnection(courses.retire)(req.courseContext, req.params.id, req.body.expectedRevision) })));

  router.use(async (error, req, res, next) => {
    if (res.headersSent) return next(error);
    const temporaryFiles = Object.values(req.files || {}).flat().filter(Boolean).map(file => file.tempFilePath).filter(Boolean);
    await Promise.all(temporaryFiles.map(file => fs.rm(file, { force: true }).catch(() => {})));
    const code = error.code || 'TRAINING_CATALOGUE_UNAVAILABLE';
    const status = Number.isInteger(error.status) ? error.status
      : error.httpCode === 413 ? 413
        : code === 'COURSE_MEDIA_UPLOAD_BUSY' ? 429
        : code === 'PERMISSION_DENIED' ? 403
          : ['VERIFIED_BUSINESS_OWNER_REQUIRED', 'BUSINESS_LINK_INVALID', 'COURSE_NOT_FOUND', 'BATCH_NOT_FOUND', 'ENROLLMENT_NOT_FOUND', 'COURSE_MEDIA_NOT_FOUND'].includes(code) ? 404
          : ['STALE_REVISION', 'COURSE_RETIRED', 'ACTIVE_OFFER_REQUIRED', 'BATCH_HAS_RESERVATIONS', 'CAPACITY_BELOW_RESERVED', 'ER_DUP_ENTRY', 'FULL_PAYMENT_REQUIRED', 'ENROLLMENT_CANNOT_START', 'ENROLLMENT_MUST_BE_STARTED', 'ENROLLMENT_MUST_BE_COMPLETED', 'COURSE_MEDIA_LIMIT_REACHED', 'COURSE_MEDIA_QUOTA_EXCEEDED'].includes(code) ? 409
              : code === 'COURSE_MEDIA_TOO_LARGE' ? 413
                : ['COURSE_MEDIA_TYPE_NOT_ALLOWED', 'COURSE_MEDIA_SIGNATURE_INVALID'].includes(code) ? 415
                  : code.startsWith('INVALID_') ? 400
                    : ['ACCOUNT_INACTIVE', 'CATEGORY_UNAVAILABLE', 'FEATURE_UNAVAILABLE'].includes(code) ? 409 : 503;
    res.status(status).json({ success: false, code: status >= 500 ? 'TRAINING_CATALOGUE_UNAVAILABLE' : code === 'ER_DUP_ENTRY' ? 'CATALOGUE_CODE_EXISTS' : code });
  });
  return router;
}

module.exports = { createTrainingCourseRouter };
