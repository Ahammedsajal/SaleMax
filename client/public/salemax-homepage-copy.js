(() => {
  'use strict';

  if (window.location.pathname !== '/') return;

  const EN = new Map([
    ['Business tools for every team', 'Business automation for Training Centers'],
    ['Send bulk messages, deploy AI chatbots, manage your team inbox, run voice call campaigns and automate everything — no code needed.', 'Organize leads, customer conversations and follow-ups in one CRM. Run WhatsApp campaigns and automate routine replies with chatbots and flows. Training Center accounts can also manage invoices in the same workspace.'],
    ['Get started free', 'Get started'],
    ['Build automations without code', 'Automate conversations and follow-ups'],
    ['Drag nodes, connect steps, and launch chatbot flows in minutes. Automate WhatsApp and Telegram responses, route conversations, and trigger webhooks — zero developer needed.', 'Create guided WhatsApp replies, collect enquiry details, route conversations and trigger follow-ups with visual workflow tools.'],
    ['Every conversation,', 'From enquiry to follow-up,'],
    ['one place', 'in one workspace'],
    ['Assign agents, add labels, write notes, filter conversations and reply — all from a single unified inbox. Works with WhatsApp API, QR, and Telegram.', 'Keep team conversations organized, assign an owner, add notes and plan the next follow-up from a shared inbox. WhatsApp connection options depend on your account setup.'],
    ['Everything you need', 'Connected customer workflows'],
    ['One platform,', 'From enquiry to follow-up,'],
    ['every feature', 'in one workspace'],
    ['Multi-channel', 'WhatsApp, CRM & invoicing'],
    ['Connect WhatsApp Your Way', 'WhatsApp messaging & shared inbox'],
    ['Link via QR scan, Meta Embed Login, or manual API setup. Supports both WhatsApp QR Plugin and Meta Business API — all from one dashboard.', 'Connect WhatsApp using the methods available to your account, then manage customer conversations alongside leads and follow-ups in SaleMaX.'],
    ['Automation Flows & Chatbots', 'Chatbots & workflow automation'],
    ['Build powerful WhatsApp chatbots and automation flows with a drag-and-drop builder. Trigger actions, route conversations, and respond instantly — zero code.', 'Use chatbots and flows to answer common questions, capture enquiry details, route conversations and prompt your team to follow up.'],
    ['Campaigns & Broadcasting', 'WhatsApp campaigns'],
    ['Create Meta-approved templates, send bulk campaigns to your phonebook, and track every message from a live campaign dashboard.', 'Organize contacts, prepare campaigns with supported WhatsApp templates, and review campaign activity. Follow the consent and messaging requirements that apply to your WhatsApp account.'],
    ['Webhooks & REST API', 'CRM, leads & invoicing'],
    ['Integrate SaleMaX with any external tool using webhooks and the Meta REST API. Automate routing logic, sync data, and monitor every event in real time.', 'Track leads, assign owners, manage sales stages and follow up with customers. Invoicing workflows are available for Training Center accounts.'],
    ['Inbox, Agents & Tasks', 'Team inbox & follow-up'],
    ['Manage your entire support team from one unified inbox. Assign conversations to agents, track tasks, add a chat widget to your site, and monitor performance.', 'Coordinate customer conversations, assign follow-ups and give each team member access according to their role.'],
    ['Customer Stories', 'What SaleMaX helps you do'],
    ['Real results from real teams — see how SaleMaX helps businesses automate, grow, and delight customers on WhatsApp.', 'Bring leads, customer conversations, WhatsApp campaigns and follow-ups together in one business workspace.'],
    ['SaleMaX completely transformed how we communicate with customers. Our open rates went from 20% to 94% overnight. Absolutely game-changing.', 'Keep enquiries, contacts and next steps organized in one CRM.'],
    ['Sarah Johnson', 'CRM & sales pipeline'],
    ['Head of Marketing, TechCorp', 'Lead tracking and follow-up'],
    ['The chatbot builder is insanely powerful. We automated 80% of our support tickets in the first week. The ROI has been incredible.', 'Set up guided replies and route conversations to the right team member.'],
    ['Marcus Lee', 'Chatbots & workflows'],
    ['CEO, GrowthLabs', 'Automated replies and routing'],
    ['Bulk broadcasting with Meta API is seamless. We ran a campaign to 50,000 contacts in minutes. Delivery rate blew us away.', 'Plan WhatsApp campaigns and keep customer conversations connected to your team.'],
    ['Priya Sharma', 'WhatsApp campaigns'],
    ['E-commerce Director, ShopNow', 'Campaigns and customer conversations'],
    ['SJ', 'CRM'],
    ['ML', 'BOT'],
    ['PS', 'WA'],
    ['This is a trial plan with all the featrues', 'Explore the features available in this trial plan.'],
    ['Simple Pricing', 'Plans for your business'],
    ['Start free, scale as you grow. No hidden fees, cancel anytime.', 'Compare the current plans, prices and included limits to find the right fit for your team.'],
    ['End-to-End Encrypted', 'WhatsApp conversations'],
    ['99.9% Uptime SLA', 'CRM and lead pipeline'],
    ['Sub-second Delivery', 'Campaign management'],
    ['Multi-device Ready', 'Training Center invoicing'],
    ['Get started today', 'Bring your team into one workspace'],
    ['Ready to grow your business?', 'Manage leads, conversations and follow-ups with SaleMaX'],
    ['Join 50,000+ businesses already using SaleMaX to automate their WhatsApp marketing and support.', 'Organize leads, run WhatsApp campaigns, automate routine replies and keep follow-ups moving. Training Center accounts can also manage invoices in SaleMaX.'],
    ['No credit card required', 'WhatsApp campaigns'],
    ['Free 14-day trial', 'CRM & lead management'],
    ['Cancel anytime', 'Training Center invoicing'],
    ['4.9 / 5 · 2,400+ reviews', 'CRM · WhatsApp · business automation'],
    ['Questions we get', 'Questions about'],
    ['all the time', 'SaleMaX'],
    ["Can't find what you're looking for? Reach out to our support team and we'll get back to you within a few hours.", 'Learn how SaleMaX connects customer conversations, lead management, WhatsApp campaigns, automation and Training Center invoicing.'],
    ['The most powerful WhatsApp marketing platform for modern businesses. Automate, engage, and grow.', 'SaleMaX brings CRM, WhatsApp messaging, campaigns, chatbots and business workflows together. Training Center accounts can manage invoices in the same workspace.'],
    ['Testimonials', 'Workflows']
  ]);

  const AR = new Map([
    ['Business tools for every team', 'أتمتة الأعمال لمراكز التدريب'],
    ['أرسل رسائل جماعية، فعل روبوتات الذكاء الاصطناعي، أدر صندوق وارد فريقك، أطلق حملات مكالمات صوتية وأتمت كل شيء — بدون كود.', 'نظّم العملاء المحتملين ومحادثاتهم ومتابعاتهم في CRM واحد. أطلق حملات واتساب وأتمت الردود المتكررة عبر روبوتات المحادثة والتدفقات. ويمكن لمراكز التدريب إدارة الفواتير من مساحة العمل نفسها.'],
    ['ابدأ مجاناً', 'ابدأ الآن'],
    ['Build automations without code', 'أتمت المحادثات والمتابعات'],
    ['Drag nodes, connect steps, and launch chatbot flows in minutes. Automate WhatsApp and Telegram responses, route conversations, and trigger webhooks — zero developer needed.', 'أنشئ ردود واتساب إرشادية، واجمع تفاصيل الاستفسارات، ووجّه المحادثات وفعّل المتابعات باستخدام أدوات سير العمل المرئية.'],
    ['Assign agents, add labels, write notes, filter conversations and reply — all from a single unified inbox. Works with WhatsApp API, QR, and Telegram.', 'نظّم محادثات الفريق، وحدد المسؤول، وأضف الملاحظات وخطط للمتابعة التالية من صندوق وارد مشترك. تعتمد خيارات ربط واتساب على إعداد حسابك.'],
    ['Every conversation,', 'من الاستفسار إلى المتابعة،'],
    ['one place', 'في مساحة عمل واحدة'],
    ['Assign agents, add labels, write notes, filter conversations and reply — all from a single unified inbox. Works with WhatsApp API, QR, and Telegram.', 'نظّم محادثات الفريق، وحدد المسؤول، وأضف الملاحظات وخطط للمتابعة التالية من صندوق وارد مشترك. تعتمد خيارات ربط واتساب على إعداد حسابك.'],
    ['كل ما تحتاجه', 'مسارات عمل مترابطة للعملاء'],
    ['منصة واحدة،', 'من الاستفسار إلى المتابعة،'],
    ['كل الميزات', 'في مساحة عمل واحدة'],
    ['قنوات متعددة', 'واتساب وCRM والفواتير'],
    ['اربط واتساب بطريقتك', 'مراسلات واتساب وصندوق وارد مشترك'],
    ['Automation Flows & Chatbots', 'روبوتات المحادثة وأتمتة سير العمل'],
    ['Link via QR scan, Meta Embed Login, or manual API setup. Supports both WhatsApp QR Plugin and Meta Business API — all from one dashboard.', 'اربط واتساب بالطرق المتاحة لحسابك، ثم أدر محادثات العملاء إلى جانب العملاء المحتملين والمتابعات في SaleMaX.'],
    ['Build powerful WhatsApp chatbots and automation flows with a drag-and-drop builder. Trigger actions, route conversations, and respond instantly — zero code.', 'استخدم روبوتات المحادثة والتدفقات للإجابة عن الأسئلة الشائعة، وجمع تفاصيل الاستفسارات، وتوجيه المحادثات وتنبيه فريقك للمتابعة.'],
    ['Create Meta-approved templates, send bulk campaigns to your phonebook, and track every message from a live campaign dashboard.', 'نظّم جهات الاتصال، وجهّز الحملات باستخدام قوالب واتساب المتاحة، وتابع نشاط الحملة. التزم بمتطلبات الموافقة والمراسلة الخاصة بحساب واتساب لديك.'],
    ['Integrate SaleMaX with any external tool using webhooks and the Meta REST API. Automate routing logic, sync data, and monitor every event in real time.', 'تابع العملاء المحتملين، وحدد المسؤول، وأدر مراحل المبيعات وتابع العملاء. تتوفر إدارة الفواتير لحسابات مراكز التدريب.'],
    ['Manage your entire support team from one unified inbox. Assign conversations to agents, track tasks, add a chat widget to your site, and monitor performance.', 'نسّق محادثات العملاء، وحدد مهام المتابعة، وامنح كل عضو صلاحيات تناسب دوره.'],
    ['This is a trial plan with all the featrues', 'تعرف على الميزات المتاحة ضمن هذه الخطة التجريبية.'],
    ['Build powerful WhatsApp chatbots and automation flows with a drag-and-drop builder. Trigger actions, route conversations, and respond instantly — zero code.', 'استخدم روبوتات المحادثة والتدفقات للإجابة عن الأسئلة الشائعة، وجمع تفاصيل الاستفسارات، وتوجيه المحادثات وتنبيه فريقك للمتابعة.'],
    ['Campaigns & Broadcasting', 'حملات واتساب'],
    ['Create Meta-approved templates, send bulk campaigns to your phonebook, and track every message from a live campaign dashboard.', 'نظّم جهات الاتصال، وجهّز الحملات باستخدام قوالب واتساب المتاحة، وتابع نشاط الحملة. التزم بمتطلبات الموافقة والمراسلة الخاصة بحساب واتساب لديك.'],
    ['Webhooks & REST API', 'CRM والعملاء المحتملون والفواتير'],
    ['Integrate SaleMaX with any external tool using webhooks and the Meta REST API. Automate routing logic, sync data, and monitor every event in real time.', 'تابع العملاء المحتملين، وحدد المسؤول، وأدر مراحل المبيعات وتابع العملاء. تتوفر إدارة الفواتير لحسابات مراكز التدريب.'],
    ['Inbox, Agents & Tasks', 'صندوق فريق العمل والمتابعة'],
    ['Manage your entire support team from one unified inbox. Assign conversations to agents, track tasks, add a chat widget to your site, and monitor performance.', 'نسّق محادثات العملاء، وحدد مهام المتابعة، وامنح كل عضو صلاحيات تناسب دوره.'],
    ['اربط عبر مسح QR، دخول Meta المدمج، أو إعداد API يدوي. يدعم كلاً من إضافة WhatsApp QR و Meta Business API — كل ذلك من لوحة تحكم واحدة. ربط عبر رمز QR دخول Meta المدمج وصول عبر REST API بدون كود', 'اربط واتساب بالطرق المتاحة لحسابك، ثم أدر محادثات العملاء إلى جانب العملاء المحتملين والمتابعات في SaleMaX.'],
    ['Build automations without code', 'أتمت المحادثات والمتابعات'],
    ['Drag nodes, connect steps, and launch chatbot flows in minutes. Automate WhatsApp and Telegram responses, route conversations, and trigger webhooks — zero developer needed.', 'أنشئ ردود واتساب إرشادية، واجمع تفاصيل الاستفسارات، ووجّه المحادثات وفعّل المتابعات باستخدام أدوات سير العمل المرئية.'],
    ['Assign agents, add labels, write notes, filter conversations and reply — all from a single unified inbox. Works with WhatsApp API, QR, and Telegram.', 'نظّم محادثات الفريق، وحدد المسؤول، وأضف الملاحظات وخطط للمتابعة التالية من صندوق وارد مشترك. تعتمد خيارات ربط واتساب على إعداد حسابك.'],
    ['Drag nodes, connect steps, and launch chatbot flows in minutes. Automate WhatsApp and Telegram responses, route conversations, and trigger webhooks — zero developer needed.', 'أنشئ ردود واتساب إرشادية، واجمع تفاصيل الاستفسارات، ووجّه المحادثات وفعّل المتابعات باستخدام أدوات سير العمل المرئية.'],
    ['Every conversation,', 'من الاستفسار إلى المتابعة،'],
    ['one place', 'في مساحة عمل واحدة'],
    ['Assign agents, add labels, write notes, filter conversations and reply — all from a single unified inbox. Works with WhatsApp API, QR, and Telegram.', 'نظّم محادثات الفريق، وحدد المسؤول، وأضف الملاحظات وخطط للمتابعة التالية من صندوق وارد مشترك. تعتمد خيارات ربط واتساب على إعداد حسابك.'],
    ['Everything you need', 'مسارات عمل مترابطة للعملاء'],
    ['One platform,', 'من الاستفسار إلى المتابعة،'],
    ['every feature', 'في مساحة عمل واحدة'],
    ['Multi-channel', 'واتساب وCRM والفواتير'],
    ['Connect WhatsApp Your Way', 'مراسلات واتساب وصندوق وارد مشترك'],
    ['Link via QR scan, Meta Embed Login, or manual API setup. Supports both WhatsApp QR Plugin and Meta Business API — all from one dashboard.', 'اربط واتساب بالطرق المتاحة لحسابك، ثم أدر محادثات العملاء إلى جانب العملاء المحتملين والمتابعات في SaleMaX.'],
    ['تدفقات الأتمتة والروبوتات', 'روبوتات المحادثة وأتمتة سير العمل'],
    ['ابنِ روبوتات واتساب قوية وتدفقات أتمتة باستخدام منشئ السحب والإفلات. فعل الإجراءات، وجه المحادثات، ورد فوراً — بدون كود. منشئ تدفق بصري روبوت واتساب مشغلات Webhook البث الجماعي', 'استخدم روبوتات المحادثة والتدفقات للإجابة عن الأسئلة الشائعة، وجمع تفاصيل الاستفسارات، وتوجيه المحادثات وتنبيه فريقك للمتابعة.'],
    ['الحملات والبث', 'حملات واتساب'],
    ['أنشئ قوالب معتمدة من Meta، أرسل حملات جماعية لدفتر هاتفك، وتتبع كل رسالة من لوحة تحكم الحملات المباشرة. منشئ قوالب Meta حملات جماعية تحليلات الحملة للمطورين', 'نظّم جهات الاتصال، وجهّز الحملات باستخدام قوالب واتساب المتاحة، وتابع نشاط الحملة. التزم بمتطلبات الموافقة والمراسلة الخاصة بحساب واتساب لديك.'],
    ['الـ Webhooks و REST API', 'CRM والعملاء المحتملون والفواتير'],
    ['اربط SaleMaX مع أي أداة خارجية باستخدام الـ Webhooks و Meta REST API. أتمت منطق التوجيه، زامن البيانات، وراقب كل حدث في الوقت الفعلي. أتمتة Webhook واجهة برمجة المحادثات واجهة برمجة القوالب للفريق', 'تابع العملاء المحتملين، وحدد المسؤول، وأدر مراحل المبيعات وتابع العملاء. تتوفر إدارة الفواتير لحسابات مراكز التدريب.'],
    ['صندوق الوارد، الوكلاء والمهام', 'صندوق فريق العمل والمتابعة'],
    ['أدر فريق الدعم بالكامل من صندوق وارد موحد. عين المحادثات للوكلاء، تتبع المهام، أضف ودجت محادثة لموقعك، وراقب الأداء. صندوق وارد موحد إدارة مهام الوكلاء تضمين ودجت المحادثة', 'نسّق محادثات العملاء، وحدد مهام المتابعة، وامنح كل عضو صلاحيات تناسب دوره.'],
    ['قصص العملاء', 'ما الذي يساعدك SaleMaX على إنجازه'],
    ['نتائج حقيقية من فرق حقيقية — شاهد كيف يساعد SaleMaX الشركات على الأتمتة، النمو، وإسعاد العملاء عبر واتساب.', 'اجمع العملاء المحتملين ومحادثات واتساب والحملات والمتابعات في مساحة عمل واحدة.'],
    ['SaleMaX غير تماماً طريقة تواصلنا مع العملاء. ارتفعت معدلات الفتح لدينا من 20% إلى 94% بين عشية وضحاها. تغيير جذري فعلاً.', 'نظّم الاستفسارات وجهات الاتصال والخطوات التالية في CRM واحد.'],
    ['سارة جونسون', 'CRM ومراحل المبيعات'],
    ['مديرة التسويق، TechCorp', 'متابعة العملاء المحتملين'],
    ['منشئ الروبوتات قوي بشكل لا يصدق. أتمتنا 80% من تذاكر الدعم في الأسبوع الأول. العائد على الاستثمار كان مذهلاً.', 'أنشئ ردوداً إرشادية ووجّه المحادثات إلى عضو الفريق المناسب.'],
    ['ماركوس لي', 'روبوتات المحادثة والتدفقات'],
    ['الرئيس التنفيذي، GrowthLabs', 'الردود والتوجيه الآلي'],
    ['البث الجماعي عبر Meta API سلس للغاية. أطلقنا حملة لـ 50,000 جهة اتصال في دقائق. معدل التسليم أبهرنا.', 'خطط لحملات واتساب واربط محادثات العملاء بفريقك.'],
    ['بريا شارما', 'حملات واتساب'],
    ['مديرة التجارة الإلكترونية، ShopNow', 'الحملات ومحادثات العملاء'],
    ['SJ', 'CRM'],
    ['ML', 'BOT'],
    ['PS', 'WA'],
    ['أسعار بسيطة', 'خطط تناسب أعمالك'],
    ['ابدأ مجاناً، وتوسع مع نموك. لا توجد رسوم خفية، إلغاء في أي وقت.', 'قارن الخطط والأسعار والحدود المتاحة حالياً لاختيار ما يناسب فريقك.'],
    ['تشفير تام (End-to-End)', 'محادثات واتساب'],
    ['End-to-End Encrypted', 'محادثات واتساب'],
    ['99.9% Uptime SLA', 'CRM ومراحل العملاء'],
    ['Sub-second Delivery', 'إدارة الحملات'],
    ['Multi-device Ready', 'فواتير مراكز التدريب'],
    ['No credit card required', 'حملات واتساب'],
    ['Free 14-day trial', 'إدارة العملاء المحتملين'],
    ['Cancel anytime', 'فواتير مراكز التدريب'],
    ['4.9 / 5 · 2,400+ reviews', 'CRM · واتساب · أتمتة الأعمال'],
    ['99.9% ضمان تشغيل (SLA)', 'CRM ومراحل العملاء'],
    ['تسليم في أجزاء من الثانية', 'إدارة الحملات'],
    ['جاهز للأجهزة المتعددة', 'فواتير مراكز التدريب'],
    ['ابدأ اليوم', 'اجمع فريقك في مساحة عمل واحدة'],
    ['مستعد لتنمية عملك؟', 'أدر العملاء والمحادثات والمتابعات مع SaleMaX'],
    ['انضم إلى أكثر من 50,000 شركة تستخدم SaleMaX بالفعل لأتمتة تسويقها ودعمها عبر واتساب. No credit card required Free 14-day trial Cancel anytime', 'نظّم العملاء المحتملين، وأطلق حملات واتساب، وأتمت الردود المتكررة وتابع العملاء. ويمكن لمراكز التدريب إدارة الفواتير في SaleMaX.'],
    ['No credit card required', 'حملات واتساب'],
    ['Free 14-day trial', 'إدارة العملاء المحتملين'],
    ['Cancel anytime', 'فواتير مراكز التدريب'],
    ['4.9 / 5 · 2,400+ reviews', 'CRM · واتساب · أتمتة الأعمال'],
    ['أسئلة نتلقاها', 'أسئلة حول'],
    ['دائماً', 'SaleMaX'],
    ['لا تجد ما تبحث عنه؟ تواصل مع فريق الدعم وسنرد عليك خلال ساعات قليلة.', 'تعرف على كيفية ربط SaleMaX لمحادثات العملاء وإدارة العملاء المحتملين وحملات واتساب والأتمتة وفواتير مراكز التدريب.'],
    ['The most powerful WhatsApp marketing platform for modern businesses. Automate, engage, and grow.', 'يجمع SaleMaX بين CRM ومراسلات واتساب والحملات وروبوتات المحادثة وسير العمل. ويمكن لمراكز التدريب إدارة الفواتير في المساحة نفسها.'],
    ['Testimonials', 'مسارات العمل'],
    ['شهادات العملاء', 'مسارات العمل'],
    ['Customer Stories', 'ما الذي يساعدك SaleMaX على إنجازه'],
    ['Real results from real teams — see how SaleMaX helps businesses automate, grow, and delight customers on WhatsApp.', 'اجمع العملاء المحتملين ومحادثات واتساب والحملات والمتابعات في مساحة عمل واحدة.'],
    ['Simple Pricing', 'خطط تناسب أعمالك'],
    ['Start free, scale as you grow. No hidden fees, cancel anytime.', 'قارن الخطط والأسعار والحدود المتاحة حالياً لاختيار ما يناسب فريقك.'],
    ['Get started today', 'اجمع فريقك في مساحة عمل واحدة'],
    ['Ready to grow your business?', 'أدر العملاء والمحادثات والمتابعات مع SaleMaX'],
    ['Join 50,000+ businesses already using SaleMaX to automate their WhatsApp marketing and support.', 'نظّم العملاء المحتملين، وأطلق حملات واتساب، وأتمت الردود المتكررة وتابع العملاء. ويمكن لمراكز التدريب إدارة الفواتير في SaleMaX.'],
    ["Can't find what you're looking for? Reach out to our support team and we'll get back to you within a few hours.", 'تعرف على كيفية ربط SaleMaX لمحادثات العملاء وإدارة العملاء المحتملين وحملات واتساب والأتمتة وفواتير مراكز التدريب.']
  ]);

  const HERO_COPY = {
    en: new Map([
      ['Business tools for every team', 'Business automation for Training Centers'],
      ['The #1', 'Business automation'],
      ['Smart Inbox', 'CRM + WhatsApp'], ['Flow Builder', 'CRM + WhatsApp'],
      ['AI Chatbot Flows', 'CRM + WhatsApp'], ['WhatsApp Automation', 'CRM + WhatsApp'],
      ['growth platform', 'for Training Centers'], ['Loved by', 'CRM, WhatsApp &'],
      ['50,000+', 'automation'], ['businesses worldwide', 'in one workspace'],
      ['Loved by 50,000+ businesses worldwide', 'CRM, WhatsApp & business automation for growing teams'],
      ['AK', 'CRM'], ['CR', 'WA'], ['PS', 'BOT'], ['ML', 'INV'], ['SJ', 'OPS']
    ]),
    ar: new Map([
      ['Business tools for every team', 'أتمتة الأعمال لمراكز التدريب'],
      ['منصة', 'أتمتة الأعمال'], ['The #1', 'أتمتة الأعمال'],
      ['إدارة جهات الاتصال (CRM)', 'وCRM'],
      ['موثوق من قبل 50,000+ شركات حول العالم', 'CRM وواتساب وأتمتة الأعمال في مساحة واحدة'],
      ['50,000+ شركة حول العالم', 'CRM وواتساب وأتمتة الأعمال في مساحة واحدة'],
      ['Smart Inbox', 'CRM وواتساب'], ['Flow Builder', 'CRM وواتساب'],
      ['AI Chatbot Flows', 'CRM وواتساب'], ['WhatsApp Automation', 'CRM وواتساب'],
      ['growth platform', 'لمراكز التدريب'], ['واتساب المتكاملة', 'لمراكز التدريب'],
      ['موثوق من قبل', 'CRM وواتساب'], ['50,000+', 'وأتمتة'],
      ['شركات حول العالم', 'في مساحة واحدة'],
      ['AK', 'CRM'], ['CR', 'WA'], ['PS', 'BOT'], ['ML', 'INV'], ['SJ', 'OPS']
    ])
  };

  const FAQ = {
    en: [
      ['What is SaleMaX and how does it work?', 'What is SaleMaX?', 'SaleMaX is a business automation platform built around CRM and WhatsApp. It helps teams organize leads and customer conversations, run campaigns, automate common replies with chatbots and flows, track follow-ups, and manage invoices for Training Center workflows.'],
      ['Do I need a verified WhatsApp Business account?', 'How can I connect WhatsApp?', 'Connection requirements depend on the method and account. Meta Business Platform connections require the relevant Meta and WhatsApp Business setup. QR connections have separate requirements; review the current setup steps before connecting a number.'],
      ['Is there a free trial available?', 'Which plan is right for my business?', 'Available plans, prices, terms and included limits are shown in the pricing section. Compare them with the users, contacts and features your team needs.'],
      ['Can I broadcast messages to thousands of contacts?', 'Can SaleMaX run WhatsApp campaigns?', 'SaleMaX helps you organize contacts and send campaigns using supported WhatsApp messaging methods and templates. Follow the consent and messaging requirements that apply to your account.'],
      ['How does the AI chatbot builder work?', 'What can I automate?', 'Use chatbots and flows to answer common questions, collect enquiry details, route conversations and prompt follow-up tasks. Available channels and features depend on your account setup.'],
      ['Can multiple agents use the same WhatsApp number?', 'Can my team share the inbox?', 'Team members can work from a shared business inbox with role-based access where enabled. Assign conversations and follow-ups so each lead has an owner.'],
      ['Is my data secure?', 'Can SaleMaX manage sales and invoices?', 'The CRM pipeline helps you track leads, owners, stages and next steps. Invoice workflows are available for supported business categories; enabled features depend on your account and plan.']
    ],
    ar: [
      ['ما هو SaleMaX وكيف يعمل؟', 'ما هو SaleMaX؟', 'SaleMaX منصة لأتمتة الأعمال ترتكز على CRM وواتساب. تساعد الفرق على تنظيم العملاء المحتملين ومحادثاتهم، وإطلاق الحملات، وأتمتة الردود الشائعة عبر روبوتات المحادثة والتدفقات، ومتابعة العملاء، وإدارة فواتير مراكز التدريب.'],
      ['هل أحتاج إلى حساب واتساب للأعمال موثق؟', 'كيف أربط واتساب؟', 'تعتمد متطلبات الربط على الطريقة والحساب. يتطلب الربط عبر Meta Business Platform إعدادات Meta وواتساب للأعمال المناسبة. وللربط عبر QR متطلبات مختلفة؛ راجع خطوات الإعداد الحالية قبل ربط الرقم.'],
      ['هل تتوفر تجربة مجانية؟', 'ما الخطة المناسبة لعملي؟', 'تعرض صفحة الأسعار الخطط والأسعار والشروط والحدود المتاحة. قارن بينها وبين عدد المستخدمين وجهات الاتصال والميزات التي يحتاجها فريقك.'],
      ['هل يمكنني بث رسائل لآلاف جهات الاتصال؟', 'هل يدعم SaleMaX حملات واتساب؟', 'يساعدك SaleMaX على تنظيم جهات الاتصال وإرسال الحملات بطرق مراسلة وقوالب واتساب المتاحة. التزم بمتطلبات الموافقة والمراسلة الخاصة بحسابك.'],
      ['كيف يعمل منشئ روبوتات الذكاء الاصطناعي؟', 'ما الذي يمكنني أتمتته؟', 'استخدم روبوتات المحادثة والتدفقات للإجابة عن الأسئلة الشائعة، وجمع تفاصيل الاستفسارات، وتوجيه المحادثات وإنشاء مهام للمتابعة. تعتمد القنوات والميزات المتاحة على إعداد حسابك.'],
      ['هل يمكن لعدة وكلاء استخدام نفس رقم الواتساب؟', 'هل يمكن لفريقي استخدام صندوق وارد مشترك؟', 'يمكن لأعضاء الفريق العمل من صندوق وارد مشترك بصلاحيات حسب الدور عند تفعيلها. عيّن المحادثات والمتابعات ليكون لكل عميل محتمل مسؤول.'],
      ['هل بياناتي آمنة؟', 'هل يدير SaleMaX المبيعات والفواتير؟', 'يساعدك مسار CRM على متابعة العملاء والمسؤولين والمراحل والخطوات التالية. تتوفر الفواتير لفئات الأعمال المدعومة، وتعتمد الميزات المفعّلة على الفئة والخطة في حسابك.']
    ]
  };

  function language() {
    const labels = [...document.querySelectorAll('button')].map(button => button.textContent.trim());
    return labels.includes('Lang Arabic') ? 'ar' : 'en';
  }

  function replaceText(root, map) {
    if (!root) return;
    const walker = document.createTreeWalker(root, 4);
    let node;
    while ((node = walker.nextNode())) {
      const current = node.nodeValue.trim();
      const replacement = map.get(current);
      if (replacement === undefined || replacement === current) continue;
      const leading = node.nodeValue.match(/^\s*/)?.[0] || '';
      const trailing = node.nodeValue.match(/\s*$/)?.[0] || '';
      node.nodeValue = `${leading}${replacement}${trailing}`;
    }
  }

  function heroRoot() {
    const heading = document.querySelector('h1');
    for (let node = heading; node && node !== document.body; node = node.parentElement) {
      if (node.querySelector('button') && /Get started|ابدأ/.test(node.innerText || '')) return node;
    }
    return null;
  }

  function updateFaq(entries) {
    for (const accordion of document.querySelectorAll('.MuiAccordion-root')) {
      const question = accordion.querySelector('.MuiAccordion-heading p:nth-of-type(2)');
      if (!question) continue;
      const entry = entries.find(item => item[0] === question.textContent.trim() || item[1] === question.textContent.trim());
      if (!entry) continue;
      if (question.textContent !== entry[1]) question.textContent = entry[1];
      const answer = accordion.querySelector('.MuiAccordionDetails-root p');
      if (answer && answer.textContent !== entry[2]) answer.textContent = entry[2];
    }
  }

  function updateSectionHeadings(lang) {
    const entries = lang === 'ar'
      ? [
          [['موثوق من قبل', '+50,000 فريق'], ['مساحة واحدة تربط', 'مسارات عملك']],
          [['خطط تناسب كل أحجام', 'الفرق'], ['خيارات تناسب', 'احتياجات عملك']]
        ]
      : [
          [['Loved by', '50,000+ teams'], ['Designed to connect', 'your customer workflows']],
          [['Plans for every', 'team size'], ['Options for', 'your workflows']]
        ];
    for (const heading of document.querySelectorAll('h2')) {
      for (const [before, after] of entries) {
        if (!heading.textContent.includes(before[0]) || !heading.textContent.includes(before[1])) continue;
        for (const node of heading.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim() === before[0]) node.nodeValue = after[0];
          else if (node.nodeType === Node.ELEMENT_NODE && node.textContent.trim() === before[1]) node.textContent = after[1];
        }
      }
    }
  }

  let pending = false;
  function applyCopy() {
    pending = false;
    if (window.location.pathname !== '/') return;
    const lang = language();
    const copy = lang === 'ar' ? AR : EN;
    replaceText(heroRoot(), HERO_COPY[lang]);
    replaceText(document.body, copy);
    updateSectionHeadings(lang);
    updateFaq(FAQ[lang]);
  }

  function schedule() {
    if (pending) return;
    pending = true;
    queueMicrotask(applyCopy);
  }

  function start() {
    if (!document.body) return requestAnimationFrame(start);
    applyCopy();
    new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  start();
})();
