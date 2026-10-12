(() => {
  'use strict';

  if (window.location.pathname !== '/') return;

  const EN = new Map([
    ['Business tools for every team', 'Customizable CRM & WhatsApp messaging'],
    ['Send bulk messages, deploy AI chatbots, manage your team inbox, run voice call campaigns and automate everything — no code needed.', 'Customizable CRM and WhatsApp messaging for teams across industries. Organize leads, customer conversations, campaigns, chatbots and follow-ups in workflows shaped around your business.'],
    ['Get started free', 'Get started'],
    ['Build automations without code', 'Automate conversations and follow-ups'],
    ['Drag nodes, connect steps, and launch chatbot flows in minutes. Automate WhatsApp and Telegram responses, route conversations, and trigger webhooks — zero developer needed.', 'Create guided WhatsApp replies, collect enquiry details, route conversations and trigger follow-ups with visual workflow tools.'],
    ['Every conversation,', 'From enquiry to follow-up,'],
    ['one place', 'in one workspace'],
    ['Assign agents, add labels, write notes, filter conversations and reply — all from a single unified inbox. Works with WhatsApp API, QR, and Telegram.', 'Keep team conversations organized, assign an owner, add notes and plan the next follow-up from a shared inbox. Available WhatsApp connection methods depend on your account setup.'],
    ['Everything you need', 'Connected customer workflows'],
    ['One platform,', 'From enquiry to follow-up,'],
    ['every feature', 'in one workspace'],
    ['Multi-channel', 'CRM, WhatsApp & workflows'],
    ['Connect WhatsApp Your Way', 'WhatsApp messaging & shared inbox'],
    ['Link via QR scan, Meta Embed Login, or manual API setup. Supports both WhatsApp QR Plugin and Meta Business API — all from one dashboard.', 'Connect WhatsApp using the methods available to your account, then manage customer conversations alongside leads and follow-ups in SaleMaX.'],
    ['Automation Flows & Chatbots', 'Chatbots & workflow automation'],
    ['Build powerful WhatsApp chatbots and automation flows with a drag-and-drop builder. Trigger actions, route conversations, and respond instantly — zero code.', 'Use chatbots and flows to answer common questions, capture enquiry details, route conversations and prompt your team to follow up.'],
    ['Campaigns & Broadcasting', 'WhatsApp campaigns'],
    ['Create Meta-approved templates, send bulk campaigns to your phonebook, and track every message from a live campaign dashboard.', 'Organize contacts, prepare campaigns with supported WhatsApp templates, and review campaign activity. Follow the consent and messaging requirements for your WhatsApp account.'],
    ['Webhooks & REST API', 'CRM, leads & follow-up'],
    ['Integrate SaleMaX with any external tool using webhooks and the Meta REST API. Automate routing logic, sync data, and monitor every event in real time.', 'Track leads, assign owners, manage sales stages and follow up with customers. Training Center accounts can also manage invoices.'],
    ['Inbox, Agents & Tasks', 'Team inbox & follow-up'],
    ['Manage your entire support team from one unified inbox. Assign conversations to agents, track tasks, add a chat widget to your site, and monitor performance.', 'Coordinate customer conversations, assign follow-ups and give each team member access according to their role.'],
    ['Customer Stories', 'A CRM shaped around your industry'],
    ['Real results from real teams — see how SaleMaX helps businesses automate, grow, and delight customers on WhatsApp.', 'Use SaleMaX for real estate, training centers, healthcare, clinics, retail, restaurants, hospitality, fitness, beauty, automotive, education and professional services. Customize lead stages, customer messaging and follow-up workflows to fit your operation.'],
    ['SaleMaX completely transformed how we communicate with customers. Our open rates went from 20% to 94% overnight. Absolutely game-changing.', 'Keep enquiries, contacts and next steps organized in one CRM.'],
    ['Sarah Johnson', 'CRM & sales pipeline'],
    ['Head of Marketing, TechCorp', 'Lead tracking and follow-up'],
    ['The chatbot builder is insanely powerful. We automated 80% of our support tickets in the first week. The ROI has been incredible.', 'Set up guided replies and route conversations to the right team member.'],
    ['Marcus Lee', 'Chatbots & workflows'],
    ['CEO, GrowthLabs', 'Automated replies and routing'],
    ['Bulk broadcasting with Meta API is seamless. We ran a campaign to 50,000 contacts in minutes. Delivery rate blew us away.', 'Plan WhatsApp campaigns and keep customer conversations connected to your team.'],
    ['Priya Sharma', 'WhatsApp campaigns'],
    ['E-commerce Director, ShopNow', 'Campaigns and customer conversations'],
    ['SJ', 'CRM'], ['ML', 'BOT'], ['PS', 'WA'],
    ['This is a trial plan with all the featrues', 'Explore the features available in this trial plan.'],
    ['Simple Pricing', 'Plans for your business'],
    ['Start free, scale as you grow. No hidden fees, cancel anytime.', 'Compare the current plans, prices and included limits to find the right fit for your team.'],
    ['End-to-End Encrypted', 'WhatsApp conversations'],
    ['99.9% Uptime SLA', 'CRM and lead pipeline'],
    ['Sub-second Delivery', 'Campaign management'],
    ['Multi-device Ready', 'Training Center invoicing'],
    ['Get started today', 'Bring your team into one workspace'],
    ['Ready to grow your business?', 'Manage leads, conversations and follow-ups with SaleMaX'],
    ['Join 50,000+ businesses already using SaleMaX to automate their WhatsApp marketing and support.', 'Bring leads, customer conversations, WhatsApp campaigns, chatbots and follow-ups together. Configure workflows to fit your business and industry.'],
    ['No credit card required', 'CRM & WhatsApp'],
    ['Free 14-day trial', 'Custom workflows'],
    ['Cancel anytime', 'Training Center invoicing'],
    ['4.9 / 5 · 2,400+ reviews', 'CRM · WhatsApp · business automation'],
    ['Questions we get', 'Questions about'],
    ['all the time', 'SaleMaX'],
    ["Can't find what you're looking for? Reach out to our support team and we'll get back to you within a few hours.", 'Learn how SaleMaX connects CRM, customer conversations, WhatsApp campaigns, automation and industry-specific workflows.'],
    ['The most powerful WhatsApp marketing platform for modern businesses. Automate, engage, and grow.', 'SaleMaX brings customizable CRM, WhatsApp messaging, campaigns, chatbots and business workflows together. Training Center accounts can also manage invoices.'],
    ['Testimonials', 'Industries']
  ]);

  const AR = new Map([
    ['Business tools for every team', 'CRM ومراسلات واتساب قابلة للتخصيص'],
    ['أرسل رسائل جماعية، فعل روبوتات الذكاء الاصطناعي، أدر صندوق وارد فريقك، أطلق حملات مكالمات صوتية وأتمت كل شيء — بدون كود.', 'CRM ومراسلات واتساب قابلة للتخصيص للفرق في مختلف القطاعات. نظّم العملاء المحتملين ومحادثاتهم والحملات والروبوتات والمتابعات ضمن سير عمل يناسب نشاطك.'],
    ['Build automations without code', 'أتمت المحادثات والمتابعات'],
    ['كل ما تحتاجه', 'مسارات عمل مخصصة حسب القطاع'], ['قنوات متعددة', 'CRM وواتساب وسير العمل'],
    ['One platform,', 'من الاستفسار إلى المتابعة،'], ['كل الميزات', 'في مساحة عمل واحدة'],
    ['اربط واتساب بطريقتك', 'مراسلات واتساب وصندوق وارد مشترك'],
    ['اربط عبر مسح QR، دخول Meta المدمج، أو إعداد API يدوي. يدعم كلاً من إضافة WhatsApp QR و Meta Business API — كل ذلك من لوحة تحكم واحدة. ربط عبر رمز QR دخول Meta المدمج وصول عبر REST API بدون كود', 'اربط واتساب بالطرق المتاحة لحسابك، ثم أدر محادثات العملاء إلى جانب العملاء المحتملين والمتابعات في SaleMaX.'],
    ['تدفقات الأتمتة والروبوتات', 'روبوتات المحادثة وأتمتة سير العمل'],
    ['ابنِ روبوتات واتساب قوية وتدفقات أتمتة باستخدام منشئ السحب والإفلات. فعل الإجراءات، وجه المحادثات، ورد فوراً — بدون كود. منشئ تدفق بصري روبوت واتساب مشغلات Webhook البث الجماعي', 'استخدم روبوتات المحادثة والتدفقات للإجابة عن الأسئلة الشائعة، وجمع تفاصيل الاستفسارات، وتوجيه المحادثات وتنبيه فريقك للمتابعة.'],
    ['الحملات والبث', 'حملات واتساب'],
    ['أنشئ قوالب معتمدة من Meta، أرسل حملات جماعية لدفتر هاتفك، وتتبع كل رسالة من لوحة تحكم الحملات المباشرة. منشئ قوالب Meta حملات جماعية تحليلات الحملة للمطورين', 'نظّم جهات الاتصال، وجهّز الحملات باستخدام قوالب واتساب المتاحة، وتابع نشاط الحملة. التزم بمتطلبات الموافقة والمراسلة الخاصة بحساب واتساب لديك.'],
    ['الـ Webhooks و REST API', 'CRM والعملاء المحتملون والمتابعة'],
    ['اربط SaleMaX مع أي أداة خارجية باستخدام الـ Webhooks و Meta REST API. أتمت منطق التوجيه، زامن البيانات، وراقب كل حدث في الوقت الفعلي. أتمتة Webhook واجهة برمجة المحادثات واجهة برمجة القوالب للفريق', 'تابع العملاء المحتملين، وحدد المسؤول، وأدر مراحل المبيعات وتابع العملاء. ويمكن لحسابات مراكز التدريب إدارة الفواتير أيضاً.'],
    ['صندوق الوارد، الوكلاء والمهام', 'صندوق فريق العمل والمتابعة'],
    ['أدر فريق الدعم بالكامل من صندوق وارد موحد. عين المحادثات للوكلاء، تتبع المهام، أضف ودجت محادثة لموقعك، وراقب الأداء. صندوق وارد موحد إدارة مهام الوكلاء تضمين ودجت المحادثة', 'نسّق محادثات العملاء، وحدد مهام المتابعة، وامنح كل عضو صلاحيات تناسب دوره.'],
    ['قصص العملاء', 'CRM مصمم لطبيعة قطاعك'],
    ['نتائج حقيقية من فرق حقيقية — شاهد كيف يساعد SaleMaX الشركات على الأتمتة، النمو، وإسعاد العملاء عبر واتساب.', 'استخدم SaleMaX للعقارات ومراكز التدريب والرعاية الصحية والعيادات والتجزئة والمطاعم والضيافة واللياقة والجمال والسيارات والتعليم والخدمات المهنية. خصص مراحل العملاء ورسائلهم وسير المتابعة ليناسب نشاطك.'],
    ['SaleMaX غير تماماً طريقة تواصلنا مع العملاء. ارتفعت معدلات الفتح لدينا من 20% إلى 94% بين عشية وضحاها. تغيير جذري فعلاً.', 'نظّم الاستفسارات وجهات الاتصال والخطوات التالية في CRM واحد.'],
    ['منشئ الروبوتات قوي بشكل لا يصدق. أتمتنا 80% من تذاكر الدعم في الأسبوع الأول. العائد على الاستثمار كان مذهلاً.', 'أنشئ ردوداً إرشادية ووجّه المحادثات إلى عضو الفريق المناسب.'],
    ['البث الجماعي عبر Meta API سلس للغاية. أطلقنا حملة لـ 50,000 جهة اتصال في دقائق. معدل التسليم أبهرنا.', 'خطط لحملات واتساب واربط محادثات العملاء بفريقك.'],
    ['خطط تناسب كل أحجام الفرق', 'خطط تناسب سير عملك'],
    ['ابدأ مجاناً، وتوسع مع نموك. لا توجد رسوم خفية، إلغاء في أي وقت.', 'قارن الخطط والأسعار والحدود المتاحة حالياً لاختيار ما يناسب فريقك.'],
    ['انضم إلى أكثر من 50,000 شركة تستخدم SaleMaX بالفعل لأتمتة تسويقها ودعمها عبر واتساب.', 'اجمع العملاء المحتملين ومحادثات العملاء وحملات واتساب والروبوتات والمتابعات. خصص سير العمل ليناسب نشاطك وقطاعك.'],
    ['أرسل رسائل جماعية، فعل روبوتات الذكاء الاصطناعي، أدر صندوق وارد فريقك، أطلق حملات مكالمات صوتية وأتمت كل شيء — بدون كود.', 'CRM ومراسلات واتساب قابلة للتخصيص للفرق في مختلف القطاعات. نظّم العملاء المحتملين ومحادثاتهم والحملات والروبوتات والمتابعات ضمن سير عمل يناسب نشاطك.'],
    ['ابدأ مجاناً', 'ابدأ الآن'],
    ['Build automations without code', 'أتمت المحادثات والمتابعات'],
    ['Drag nodes, connect steps, and launch chatbot flows in minutes. Automate WhatsApp and Telegram responses, route conversations, and trigger webhooks — zero developer needed.', 'أنشئ ردود واتساب إرشادية، واجمع تفاصيل الاستفسارات، ووجّه المحادثات وفعّل المتابعات باستخدام أدوات سير العمل المرئية.'],
    ['Every conversation,', 'من الاستفسار إلى المتابعة،'], ['one place', 'في مساحة عمل واحدة'],
    ['Assign agents, add labels, write notes, filter conversations and reply — all from a single unified inbox. Works with WhatsApp API, QR, and Telegram.', 'نظّم محادثات الفريق، وحدد المسؤول، وأضف الملاحظات وخطط للمتابعة التالية من صندوق وارد مشترك. تعتمد خيارات ربط واتساب على إعداد حسابك.'],
    ['Everything you need', 'مسارات عمل مترابطة للعملاء'],
    ['One platform,', 'من الاستفسار إلى المتابعة،'], ['every feature', 'في مساحة عمل واحدة'],
    ['Multi-channel', 'CRM وواتساب وسير العمل'],
    ['Connect WhatsApp Your Way', 'مراسلات واتساب وصندوق وارد مشترك'],
    ['Link via QR scan, Meta Embed Login, or manual API setup. Supports both WhatsApp QR Plugin and Meta Business API — all from one dashboard.', 'اربط واتساب بالطرق المتاحة لحسابك، ثم أدر محادثات العملاء إلى جانب العملاء المحتملين والمتابعات في SaleMaX.'],
    ['Automation Flows & Chatbots', 'روبوتات المحادثة وأتمتة سير العمل'],
    ['Build powerful WhatsApp chatbots and automation flows with a drag-and-drop builder. Trigger actions, route conversations, and respond instantly — zero code.', 'استخدم روبوتات المحادثة والتدفقات للإجابة عن الأسئلة الشائعة، وجمع تفاصيل الاستفسارات، وتوجيه المحادثات وتنبيه فريقك للمتابعة.'],
    ['Campaigns & Broadcasting', 'حملات واتساب'],
    ['Create Meta-approved templates, send bulk campaigns to your phonebook, and track every message from a live campaign dashboard.', 'نظّم جهات الاتصال، وجهّز الحملات باستخدام قوالب واتساب المتاحة، وتابع نشاط الحملة. التزم بمتطلبات الموافقة والمراسلة الخاصة بحساب واتساب لديك.'],
    ['Webhooks & REST API', 'CRM والعملاء المحتملون والمتابعة'],
    ['Integrate SaleMaX with any external tool using webhooks and the Meta REST API. Automate routing logic, sync data, and monitor every event in real time.', 'تابع العملاء المحتملين، وحدد المسؤول، وأدر مراحل المبيعات وتابع العملاء. ويمكن لحسابات مراكز التدريب إدارة الفواتير أيضاً.'],
    ['Inbox, Agents & Tasks', 'صندوق فريق العمل والمتابعة'],
    ['Manage your entire support team from one unified inbox. Assign conversations to agents, track tasks, add a chat widget to your site, and monitor performance.', 'نسّق محادثات العملاء، وحدد مهام المتابعة، وامنح كل عضو صلاحيات تناسب دوره.'],
    ['Customer Stories', 'CRM مصمم لطبيعة قطاعك'],
    ['Real results from real teams — see how SaleMaX helps businesses automate, grow, and delight customers on WhatsApp.', 'استخدم SaleMaX للعقارات ومراكز التدريب والرعاية الصحية والعيادات والتجزئة والمطاعم والضيافة واللياقة والجمال والسيارات والتعليم والخدمات المهنية. خصص مراحل العملاء ورسائل العملاء وسير المتابعة ليناسب نشاطك.'],
    ['SaleMaX غير تماماً طريقة تواصلنا مع العملاء. ارتفعت معدلات الفتح لدينا من 20% إلى 94% بين عشية وضحاها. تغيير جذري فعلاً.', 'نظّم الاستفسارات وجهات الاتصال والخطوات التالية في CRM واحد.'],
    ['سارة جونسون', 'CRM ومراحل المبيعات'], ['مديرة التسويق، TechCorp', 'متابعة العملاء المحتملين'],
    ['منشئ الروبوتات قوي بشكل لا يصدق. أتمتنا 80% من تذاكر الدعم في الأسبوع الأول. العائد على الاستثمار كان مذهلاً.', 'أنشئ ردوداً إرشادية ووجّه المحادثات إلى عضو الفريق المناسب.'],
    ['ماركوس لي', 'روبوتات المحادثة والتدفقات'], ['الرئيس التنفيذي، GrowthLabs', 'الردود والتوجيه الآلي'],
    ['البث الجماعي عبر Meta API سلس للغاية. أطلقنا حملة لـ 50,000 جهة اتصال في دقائق. معدل التسليم أبهرنا.', 'خطط لحملات واتساب واربط محادثات العملاء بفريقك.'],
    ['بريا شارما', 'حملات واتساب'], ['مديرة التجارة الإلكترونية، ShopNow', 'الحملات ومحادثات العملاء'],
    ['SJ', 'CRM'], ['ML', 'BOT'], ['PS', 'WA'],
    ['This is a trial plan with all the featrues', 'تعرّف على الميزات المتاحة ضمن هذه الخطة التجريبية.'],
    ['أسعار بسيطة', 'خطط تناسب أعمالك'],
    ['ابدأ مجاناً، وتوسع مع نموك. لا توجد رسوم خفية، إلغاء في أي وقت.', 'قارن الخطط والأسعار والحدود المتاحة حالياً لاختيار ما يناسب فريقك.'],
    ['End-to-End Encrypted', 'محادثات واتساب'], ['تشفير تام (End-to-End)', 'محادثات واتساب'],
    ['99.9% Uptime SLA', 'CRM ومراحل العملاء'], ['99.9% ضمان تشغيل (SLA)', 'CRM ومراحل العملاء'],
    ['Sub-second Delivery', 'إدارة الحملات'], ['تسليم في أجزاء من الثانية', 'إدارة الحملات'],
    ['Multi-device Ready', 'فواتير مراكز التدريب'], ['جاهز للأجهزة المتعددة', 'فواتير مراكز التدريب'],
    ['ابدأ اليوم', 'اجمع فريقك في مساحة عمل واحدة'],
    ['مستعد لتنمية عملك؟', 'أدر العملاء والمحادثات والمتابعات مع SaleMaX'],
    ['انضم إلى أكثر من 50,000 شركة تستخدم SaleMaX بالفعل لأتمتة تسويقها ودعمها عبر واتساب. No credit card required Free 14-day trial Cancel anytime', 'اجمع العملاء المحتملين ومحادثات العملاء وحملات واتساب والروبوتات والمتابعات. خصص سير العمل ليناسب نشاطك وقطاعك.'],
    ['Join 50,000+ businesses already using SaleMaX to automate their WhatsApp marketing and support.', 'اجمع العملاء المحتملين ومحادثات العملاء وحملات واتساب والروبوتات والمتابعات. خصص سير العمل ليناسب نشاطك وقطاعك.'],
    ['No credit card required', 'CRM وواتساب'], ['Free 14-day trial', 'سير عمل مخصص'], ['Cancel anytime', 'فواتير مراكز التدريب'],
    ['4.9 / 5 · 2,400+ reviews', 'CRM · واتساب · أتمتة الأعمال'],
    ['أسئلة نتلقاها', 'أسئلة حول'], ['دائماً', 'SaleMaX'],
    ['لا تجد ما تبحث عنه؟ تواصل مع فريق الدعم وسنرد عليك خلال ساعات قليلة.', 'تعرف على كيفية ربط SaleMaX لإدارة العملاء ومحادثاتهم وحملات واتساب والأتمتة وسير العمل حسب القطاع.'],
    ['The most powerful WhatsApp marketing platform for modern businesses. Automate, engage, and grow.', 'يجمع SaleMaX بين CRM القابل للتخصيص ومراسلات واتساب والحملات والروبوتات وسير العمل. ويمكن لحسابات مراكز التدريب إدارة الفواتير أيضاً.'],
    ['Testimonials', 'القطاعات'], ['شهادات العملاء', 'القطاعات']
  ]);

  const HERO_COPY = {
    en: new Map([
      ['Business tools for every team', 'Customizable CRM & WhatsApp messaging'],
      ['The #1', 'Custom CRM'],
      ['Smart Inbox', 'WhatsApp messaging'], ['Flow Builder', 'customer workflows'],
      ['AI Chatbot Flows', 'automated conversations'], ['WhatsApp Automation', 'follow-up automation'],
      ['growth platform', 'for every industry'], ['for Training Centers', 'for every industry'],
      ['Loved by', 'CRM & WhatsApp for'], ['50,000+', 'business teams'],
      ['businesses worldwide', 'across industries'],
      ['AK', 'CRM'], ['CR', 'WA'], ['PS', 'BOT'], ['ML', 'INV'], ['SJ', 'OPS']
    ]),
    ar: new Map([
      ['Business tools for every team', 'CRM ومراسلات واتساب قابلة للتخصيص'],
      ['منصة', 'CRM مخصص'], ['إدارة جهات الاتصال (CRM)', 'ومراسلات واتساب'],
      ['واتساب المتكاملة', 'لكل القطاعات'], ['WhatsApp Automation', 'مراسلات واتساب'],
      ['موثوق من قبل', 'CRM وواتساب للفرق'], ['50,000+', 'في قطاعات مختلفة'],
      ['شركات حول العالم', ''],
      ['AK', 'CRM'], ['CR', 'WA'], ['PS', 'BOT'], ['ML', 'INV'], ['SJ', 'OPS']
    ])
  };

  const FAQ = {
    en: [
      ['What is SaleMaX and how does it work?', 'What is SaleMaX?', 'SaleMaX is a customizable CRM and WhatsApp business messaging platform. It helps teams manage leads and customer conversations, run campaigns, automate common replies with chatbots and workflows, and track follow-ups. Training Center accounts can also manage invoices.'],
      ['Do I need a verified WhatsApp Business account?', 'How can I connect WhatsApp?', 'Connection requirements depend on the method and account. Meta Business Platform connections require the relevant Meta and WhatsApp Business setup. QR connections have separate requirements; review the current setup steps before connecting a number.'],
      ['Is there a free trial available?', 'Which plan is right for my business?', 'Available plans, prices, terms and included limits are shown in the pricing section. Compare them with the users, contacts and features your team needs.'],
      ['Can I broadcast messages to thousands of contacts?', 'Can SaleMaX run WhatsApp campaigns?', 'SaleMaX helps you organize contacts and send campaigns using supported WhatsApp messaging methods and templates. Follow the consent and messaging requirements that apply to your account.'],
      ['How does the AI chatbot builder work?', 'What can I automate?', 'Use chatbots and flows to answer common questions, collect enquiry details, route conversations and prompt follow-up tasks. Available channels and features depend on your account setup.'],
      ['Can multiple agents use the same WhatsApp number?', 'Can my team share the inbox?', 'Team members can work from a shared business inbox with role-based access where enabled. Assign conversations and follow-ups so each lead has an owner.'],
      ['Is my data secure?', 'Can I customize SaleMaX for my industry?', 'Yes. Configure lead stages, team roles, customer messaging and follow-up workflows to fit your operation. Available capabilities depend on your account and plan. Training Center accounts can also use invoicing workflows.']
    ],
    ar: [
      ['ما هو SaleMaX وكيف يعمل؟', 'ما هو SaleMaX؟', 'SaleMaX منصة CRM ومراسلات أعمال عبر واتساب قابلة للتخصيص. تساعد الفرق على إدارة العملاء المحتملين ومحادثاتهم، وإطلاق الحملات، وأتمتة الردود الشائعة عبر الروبوتات وسير العمل، ومتابعة الخطوات التالية. ويمكن لحسابات مراكز التدريب إدارة الفواتير أيضاً.'],
      ['هل أحتاج إلى حساب واتساب للأعمال موثق؟', 'كيف أربط واتساب؟', 'تعتمد متطلبات الربط على الطريقة والحساب. يتطلب الربط عبر Meta Business Platform إعدادات Meta وواتساب للأعمال المناسبة. وللربط عبر QR متطلبات مختلفة؛ راجع خطوات الإعداد الحالية قبل ربط الرقم.'],
      ['هل تتوفر تجربة مجانية؟', 'ما الخطة المناسبة لعملي؟', 'تعرض صفحة الأسعار الخطط والأسعار والشروط والحدود المتاحة. قارن بينها وبين عدد المستخدمين وجهات الاتصال والميزات التي يحتاجها فريقك.'],
      ['هل يمكنني بث رسائل لآلاف جهات الاتصال؟', 'هل يدعم SaleMaX حملات واتساب؟', 'يساعدك SaleMaX على تنظيم جهات الاتصال وإرسال الحملات بطرق المراسلة وقوالب واتساب المتاحة. التزم بمتطلبات الموافقة والمراسلة الخاصة بحسابك.'],
      ['كيف يعمل منشئ روبوتات الذكاء الاصطناعي؟', 'ما الذي يمكنني أتمتته؟', 'استخدم الروبوتات والتدفقات للإجابة عن الأسئلة الشائعة، وجمع تفاصيل الاستفسارات، وتوجيه المحادثات وإنشاء مهام للمتابعة. تعتمد القنوات والميزات على إعداد حسابك.'],
      ['هل يمكن لعدة وكلاء استخدام نفس رقم الواتساب؟', 'هل يمكن لفريقي استخدام صندوق وارد مشترك؟', 'يمكن لأعضاء الفريق العمل من صندوق وارد مشترك بصلاحيات حسب الدور عند تفعيلها. عيّن المحادثات والمتابعات ليكون لكل عميل محتمل مسؤول.'],
      ['هل بياناتي آمنة؟', 'هل يمكن تخصيص SaleMaX لقطاعي؟', 'نعم. خصص مراحل العملاء وأدوار الفريق ورسائل العملاء والمتابعات لتناسب طريقة عملك. تعتمد الميزات المتاحة على حسابك وخطتك. ويمكن لحسابات مراكز التدريب استخدام إدارة الفواتير أيضاً.']
    ]
  };

  function language() {
    return [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Lang Arabic') ? 'ar' : 'en';
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
          [['موثوق من قبل', '+50,000 فريق'], ['CRM مصمم', 'لكل القطاعات']],
          [['خطط تناسب كل أحجام', 'الفرق'], ['خطط تناسب', 'طريقة عملك']]
        ]
      : [
          [['Loved by', '50,000+ teams'], ['Custom CRM', 'for every industry']],
          [['Plans for every', 'team size'], ['Plans for', 'your workflows']]
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
    replaceText(heroRoot(), HERO_COPY[lang]);
    replaceText(document.body, lang === 'ar' ? AR : EN);
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
