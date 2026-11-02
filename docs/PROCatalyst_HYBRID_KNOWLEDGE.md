# Pro Catalyst Hybrid bot knowledge and pilot plan

Status: verified business facts and implementation proposal; FAQs/flow still need to be saved through the authenticated owner screens. Production database read-only audit: 2 November 2026. No raw chat text, customer phone, email, student record, or credential is stored in this document.

## Conversation source and ownership

The current message history is stored in `beta_conversation`. The canonical bot profile, conversation controls, and turn records are stored in `sx_chatbot_profiles`, `sx_chatbot_conversation_controls`, and `sx_chatbot_turns`. The current owner tenant is the active `training_center` tenant for Pro Catalyst. Fourteen `sx_legacy_ownership` links were verified; the matched live conversations resolve to the owner and manager legacy identities. The transcript query joined by the tenant's verified legacy UID hashes, not by a name search.

The current `chatbot` legacy table has no Pro Catalyst rows. Current bot configuration is the canonical `sx_chatbot_profiles` profile. Current profile status is `draft`, has no channel assignment, and has no current turn records. A historical pre-purge backup did contain the old profile and bot turns in the canonical `sx_chatbot_*` tables; the historical profile's tenant/owner mapping matched Pro Catalyst. This explains why present-day zero turn counts do not mean there was no historical bot traffic.

## Aggregate conversation findings

A live, tenant-scoped read at the audit time matched 3,996 messages across 639 chats, from 13 October through 2 November 2026. Inbound traffic included text, image, audio, document, video, and location messages. Of 1,656 inbound text rows, 1,600 were classifiable as English, 10 Arabic, one other, and 45 had no usable text body. Arabic coverage is too small for a representative evaluation; use synthetic Arabic test prompts as well.

Keyword-based topic counts overlap because one question can mention more than one topic. The sampled text contained approximately 368 course mentions, 50 fee/payment/discount/refund mentions, 9 schedule/date mentions, 8 registration/form mentions, 20 location/hours mentions, 17 certificate/accreditation mentions, 19 job/employment mentions, 5 requests for a person, and 496 broad “more information/details/interested” mentions. These are routing signals, not a fully labelled intent dataset. A privacy-preserving normalized-text pass found 48 repeated question patterns, with repeated requests dominated by course information and requests for more details.

There were 46 explicitly human-attributed outbound messages across 15 chats (33 text). Outbound records without `sentBy='human'` are not counted as staff training examples. The historical pre-purge backup separately had 77 explicitly human-attributed replies across 3 chats and 98 bot replies across 9 chats; its remaining unattributed outbound messages are excluded from staff-learning claims. Historical bot-turn records included sent/replied, guided-dispatch, handoff/runtime-error, unsupported, and unavailable-flow outcomes. Current live turn counts are zero because the profile is draft.

A follow-up, content-free pairing pass found readable text in 29 of the 33 explicitly human-attributed text replies; 23 could be paired to the nearest preceding inbound text in the same owner/chat within 24 hours. The largest classified pattern was a course question followed by a fee/number response (7 pairs); broad/unclear enquiries were followed by an explanatory response (5) or a number/fee response (5). Fee/payment questions followed by a number/fee response occurred twice. These are heuristic intent/reply-shape counts only: message bodies were classified in memory and not emitted or persisted. They support reviewing selected human answers as tone/structure examples, but not training on raw transcripts or treating every staff response as approved policy. The current editor still needs owner-reviewed FAQ copy.

Eighty-four current chats had a latest inbound timestamp newer than the latest non-failed outbound record; 21 had no stored outbound record. Treat these as **reply-gap review candidates**, not confirmed unanswered enquiries: outbound provider echoes, human attribution, chat closure and unread status are incomplete signals. Review these chats in Inbox before labelling them unanswered.

Suitable anonymized examples, paraphrased from aggregate patterns:

- “I’m interested in [course]. What is the fee and how long does it take?”
- “Could you share more details about [course]?”
- “When does the next group start?”
- “Where is the training center?”
- “Can I speak with a person about a job or an existing registration?”

These are composite examples, not verbatim customer messages. Do not fine-tune on raw chats. Use only explicitly human-attributed responses as reviewed staff examples, strip personal details, and prefer approved FAQs/flow answers as the source of truth.

## Verified business facts

Active catalogue facts and offers were read from the live tenant-scoped Training Center data. Prices are current active offer values at audit time and should be fetched dynamically rather than copied into static FAQs.

| Course | Name (Arabic) | Current fee | Structured duration | Delivery |
|---|---|---:|---|---|
| Computer Skills Training – MS Office Application | MS Office Training | QAR 850 | Structured field: 10 weeks; published description and owner-confirmed range: **8–10 weeks** | Hybrid |
| Kids Python Programming | برمجة بايثون للأطفال | QAR 950 | 3 months | In person |
| Diploma in Business Management – Qualifi (UK) | دبلوم إدارة الأعمال – Qualifi (المملكة المتحدة) | QAR 3,200 | 5 months | Hybrid |
| Certificate in Nursing Assistance or Caregiver | شهادة مساعد التمريض أو مقدم الرعاية | QAR 1,450 | 3 months | Hybrid |
| Advanced Excel Professional Training | التدريب الاحترافي المتقدم على Excel | QAR 950 | 2 months | In person |
| SEN & Shadow Teacher Training | تدريب معلم التربية الخاصة ومرافق الطالب | QAR 1,500 | 3 months | Hybrid |
| Marine Deckhand | مساعد بحري على سطح السفينة | QAR 3,000 | 2 months | Hybrid |
| Diploma in Education & Training – Qualifi (UK) | دبلوم التعليم والتدريب – Qualifi (المملكة المتحدة) | QAR 3,200 | 5 months | In person |
| Diploma Health & Social Care – Qualifi (UK) | دبلوم الصحة والرعاية الاجتماعية – Qualifi (المملكة المتحدة) | QAR 3,200 | 5 months | Hybrid |
| Pre & Primary Teacher Training | تدريب معلمات رياض الأطفال والمرحلة الابتدائية | QAR 1,450 | 3 months | Hybrid |

There are no active/upcoming batches in the catalogue, so no next start dates or seats can be quoted. The registration form is published at <https://7network.live/p/pro-catalyst-05f1f2b34f/forms/student-registration> (published version 1; 30 schema fields). No separate enquiry form was present in the published-form query.

The verified address is Suhaim Tower, C Ring Road, Street 231, Doha, Qatar / برج سهيم، طريق الدائري C، شارع 231، الدوحة، قطر. Listed hours are Sunday–Thursday 10:00–19:00 and Friday 14:00–19:00. A map URL is not configured. Two bilingual approved FAQs are live: location/hours and the MS Office 8–10 week duration. No approved FAQ covers discounts, refunds, accreditation, employment, or existing-student support; route these to staff. No finance-policy record was present in the tenant policy table at audit time.

## Flow and reply policy

The existing profile is set to `guidedMode=domain_default`, has AI fallback enabled, has no custom flow ID, and currently has zero keyword reply entries. Keep the existing guided training-center flow and Inbox handoff path. If an owner-authored Flow Builder opening is selected, assign it as the existing `introFlowId`; do not create a parallel bot or channel.

| Priority | Topic and aliases | Handler | Follow-up |
|---:|---|---|---|
| 0 | Customer asks for a person: agent, human, staff, advisor; موظف، شخص، فريق | Pause bot and hand off to Inbox | None; let staff take over |
| 10 | Existing learner/account, payment/refund, complaint, certificate/accreditation, employment, or media-only request | Pause bot and hand off before AI | Ask one brief clarifying question only if the handoff workflow requires it |
| 20 | Menu/language/course list/registration form: courses, list, enrol, register, form; الدورات، القائمة، التسجيل، النموذج | Existing Guided/domain script using live courses and the published registration URL | Ask which course, only if needed |
| 30 | Course fee/duration/date: price, fee, cost, how long, when, next batch; رسوم، سعر، مدة، متى، الدفعة | Live fact lookup; return current fee/duration; missing schedule always goes to staff | Offer one next step, never invent a date or discount |
| 40 | Location/hours/refund-policy question | Exact approved bilingual FAQ or live business profile | No follow-up if answered |
| 50 | Open-ended course suitability/details | Hybrid AI with only the relevant approved facts and a bounded recent-conversation summary | One useful question at most |
| 60 | Unclear, conflicting, or unsupported request | Ask one targeted clarification or hand off | No repeated generic greeting/menu |

Suggested opening copy:

- EN: “Welcome to Pro Catalyst Training Center. I can help with courses, current fees, registration, or our location. What would you like to know?”
- AR: “مرحباً بك في مركز برو كاتاليست للتدريب. يمكنني مساعدتك بمعلومات الدورات والرسوم الحالية والتسجيل وموقع المركز. ما الذي تود معرفته؟”

Copy-ready bilingual scripts and FAQ replies for the existing editor:

| Priority | Trigger/alias | English reply | Arabic reply | Action |
|---:|---|---|---|---|
| 5 | `hi`, `hello`, `salam`; مرحباً، السلام عليكم | Use the opening copy above. | Use the opening copy above. | Start the existing guided menu/Flow Builder opening once; do not request a name before the customer asks to register. |
| 20 | `courses`, `course list`, `show courses`; الدورات، قائمة الدورات | “Here are our current courses. Which one would you like to know about?” | “إليك قائمة دوراتنا الحالية. ما الدورة التي تود معرفة المزيد عنها؟” | Render the live course list; one optional course question. |
| 30 | `fee`, `price`, `cost`, `how much`; رسوم، سعر، كم التكلفة | “I can check the current fee for you. Which course are you interested in?” | “يمكنني التحقق من الرسوم الحالية. ما الدورة التي تهمك؟” | Resolve a named course from the live offer before quoting a number. |
| 30 | `duration`, `how long`; مدة، كم تستغرق | “I can check the current course duration. Which course do you mean?” | “يمكنني التحقق من مدة الدورة الحالية. أي دورة تقصد؟” | Use live structured duration, except a published description range takes precedence; missing data goes to staff. |
| 30 | `next batch`, `start date`, `when`; الدفعة القادمة، موعد البداية، متى | “I don’t have a confirmed start date for the next batch. I’ll ask our team to confirm it for you.” | “لا يتوفر لدي موعد مؤكد لبدء الدفعة القادمة. سأطلب من فريقنا تأكيد الموعد لك.” | Pause automation and create the existing Inbox handoff. |
| 20 | `register`, `enrol`, `application form`; تسجيل، التحاق، نموذج التسجيل | “You can register using our Student Registration Form: https://7network.live/p/pro-catalyst-05f1f2b34f/forms/student-registration” | “يمكنك التسجيل عبر استمارة تسجيل الطالب: https://7network.live/p/pro-catalyst-05f1f2b34f/forms/student-registration” | Send only in response to a registration request; do not claim a submission is complete. |
| 40 | `more details`, `more information`; تفاصيل أكثر، معلومات أكثر | “Of course. Which course would you like more details about?” | “بكل سرور. عن أي دورة تود معرفة مزيد من التفاصيل؟” | Ask one clarifying question, then retrieve only that course. |
| 0 | `person`, `agent`, `staff`, `talk to a human`; أريد موظفاً، أريد التحدث مع شخص | “I’ll ask our team to help you here.” | “سأطلب من فريقنا مساعدتك هنا.” | Pause the bot and hand off to Inbox immediately. |

The location/hours and MS Office duration FAQs already saved in production should be retained. Do not add static discount, refund, accreditation, payment, employment or student-account claims until the owner approves their policy text; route those intents to staff meanwhile.

The live profile's opening wording and custom Flow Builder `introFlowId` are not yet changed. Enquiry capture should use the existing published registration form only after the customer requests registration; staff handoff should create/use the existing Inbox task/assignment path.

## Cost and acceptance gates

The tenant provider setting is OpenAI `gpt-6-luna` with a 50,000-token daily cap. The provider credential is encrypted in the existing Business Profile setting and must never enter this file. Direct course facts and approved FAQ hits use zero generation tokens; AI receives relevant facts, redacted text, and no more than four recent turns summarized to at most 700 characters. A fresh production read on 2 November found 3,434 tokens in the tenant's daily usage ledger with zero reserved tokens, but no chatbot turn rows; the daily aggregate has no conversation or feature attribution, so this cannot be claimed as Hybrid bot usage. Add per-turn usage attribution before reporting bot-specific cost. Evaluate English and Arabic outputs, provider failure, current-flow interruptions, missing batch dates, mixed language, unclear messages, staff requests and token/handoff reasons before enabling the production profile.

The test list and strict allowlist currently each contain one phone, but that phone matches an active agent and is not the requested test number `55160323`. The profile is still draft and unassigned. The active accountant has no phone recorded. Do not widen the test audience or enable automated replies until the owner reviews the exact recipient list and confirms at action time.
