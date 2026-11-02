# Pro Catalyst Hybrid bot knowledge and pilot plan

Status: live conversation and catalogue audit refreshed 2 November 2026; three bilingual FAQs are saved; first-message course-intent routing is deployed in production through app-only overlays. The Hybrid bot is active on the existing connected QR and restricted to six deduplicated owner/manager/agent test recipients. Named-course openers use the matching current course facts; generic ad-prefill “this?” openers use only a uniquely matching captured Meta referral, otherwise asking one clarification unless the same conversation has a selected course. Historical conversation counts below are pre-activation snapshots. A post-activation read-only check found no new owner/manager conversation rows or bot turns since activation; see the dated update below. No raw chat text, customer phone, email, student record, or credential is stored in this document.

## Conversation source and ownership

The current message history is stored in `beta_conversation`. The canonical bot profile, conversation controls, and turn records are stored in `sx_chatbot_profiles`, `sx_chatbot_conversation_controls`, and `sx_chatbot_turns`. The current owner tenant is the active `training_center` tenant for Pro Catalyst. Fourteen `sx_legacy_ownership` links were verified; the matched live conversations resolve to the owner and manager legacy identities. The transcript query joined by the tenant's verified legacy UID hashes, not by a name search.

The current `chatbot` legacy table has no Pro Catalyst rows. Current bot configuration is the canonical `sx_chatbot_profiles` profile. At the pre-activation audit snapshot, its status was `draft`, it had no channel assignment, and it had no current turn records. A historical pre-purge backup did contain the old profile and bot turns in the canonical `sx_chatbot_*` tables; the historical profile's tenant/owner mapping matched Pro Catalyst. This explains why zero legacy/current-turn counts in that snapshot did not mean there was no historical bot traffic. The later activation and saved-state readback are recorded below and in `DEPLOYMENT.md`.

## Aggregate conversation findings

A fresh live, tenant-scoped read matched 4,052 message rows across 644 distinct conversation IDs from 13 October through 2 November 2026. The chat summary table has 654 rows, so it includes 10 duplicate/legacy summary rows that are not distinct conversation IDs. Inbound traffic included text, image, document and audio openings. Of 1,673 readable inbound text messages, 1,616 were classifiable as English, 10 Arabic, and 47 had no usable text body; none of the classifiable messages were mixed-language. Arabic coverage is too small for a representative evaluation; use synthetic Arabic test prompts as well. The first inbound was available in 607 chats; 602 began with text and five with media.

Keyword-based topic counts overlap because one question can mention more than one topic. The latest pass found 411 course signals, 113 fee/payment signals, 84 schedule signals, 29 registration signals, 27 location signals, 23 accreditation signals, 51 employment signals, eight explicit human requests, and 491 broad “more information/details/interested” signals. These are overlapping keyword signals, not a fully labelled intent dataset. First-message audit found a named/recognized course in 261 of 607 first messages (43%); 47.8% of chats had a recognized course mention somewhere. This is a lower bound because alias recognition is conservative.

The most common normalized opening templates were 199 variants of “hello! can i get more info on this?”, 99 course-prefilled “can i get more info on certified [course] course?”, and 83 “i’m interested in the [course] & computing skills training.” Other recurring openings asked about a named teacher-training course, kids programming, or named level 4/5 programmes. These opening patterns establish that course identity is often supplied by the ad-prefilled first message; asking which course again is the wrong default. Exact Meta referral attribution is not retained in the audited rows: all chat summary `origin` values were `qr`, and conversation context contained no referral marker. Message wording looks ad-prefilled, but the database cannot prove which particular Meta ad supplied it. For a generic “more info on this?” opening, the bot may use only an explicitly captured referral context; otherwise it should ask one short clarification and never guess.

There were 33 explicitly human-attributed readable text replies; 27 could be paired to a preceding inbound message in the same chat within 24 hours. Heuristic response labels found 11 fee/amount replies, three registration replies, one handoff/contact reply, and 12 other text replies. Seven chats began with a human-attributed outbound. Outbound records without `sentBy='human'` are not counted as staff-training examples. The historical pre-purge backup separately had explicitly human-attributed replies and bot turns; its unattributed outbound messages are excluded from staff-learning claims. These conversation and turn counts are pre-activation; no live customer-facing bot turn or WhatsApp reply had been verified at the time of the saved-settings audit.

Content-free pairing found no staff response that asked “which course?” when the preceding inbound already contained a recognized course. Message bodies were inspected in memory for this audit and not emitted or persisted. Staff replies can inform tone and response structure, but do not treat every staff reply as approved policy or train on raw transcripts.

Eighty-four chats had a latest inbound timestamp newer than the latest non-failed outbound record; 21 had no stored outbound record. Thirty-eight candidates were within seven days of the audit and 46 older. Treat these as **reply-gap review candidates**, not confirmed unanswered enquiries: outbound provider echoes, human attribution, chat closure and unread status are incomplete signals. Review these chats in Inbox before labelling them unanswered.

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

The verified address is Suhaim Tower, C Ring Road, Street 231, Doha, Qatar / برج سهيم، طريق الدائري C، شارع 231، الدوحة، قطر. Listed hours are Sunday–Thursday 10:00–19:00 and Friday 14:00–19:00. A map URL is not configured. Three active FAQs are live and all have English and Arabic questions and answers: location/hours, the MS Office 8–10 week duration, and the published registration form. No approved FAQ covers discounts, refunds, accreditation, employment, or existing-student support; route these to staff. No finance-policy record was present in the tenant policy table at audit time.

## Flow and reply policy

The existing profile is set to `guidedMode=domain_default`, has AI fallback enabled, has no custom flow ID or opening flow ID, and has one bilingual registration keyword rule. Production has zero saved `wa_chatbot` Flow Builder flows. The active bot uses the built-in guided training-center opening and Inbox handoff path; no separate greeting flow was added because the guide already handles greeting-only messages and course-bearing first messages. Do not create a parallel bot or channel.

| Priority | Topic and aliases | Handler | Follow-up |
|---:|---|---|---|
| 0 | Customer asks for a person: agent, human, staff, advisor; موظف، شخص، فريق | Pause bot and hand off to Inbox | None; let staff take over |
| 10 | Existing learner/account, payment/refund, complaint, certificate/accreditation, employment, or media-only request | Pause bot and hand off before AI | Ask one brief clarifying question only if the handoff workflow requires it |
| 20 | First inbound with a named course, including Meta-prefilled “more info” or “I’m interested in” copy | Extract course from opening text, retrieve that live course card, answer its implied request; preserve the selected course for follow-ups | Never ask which course when the opening already identifies one |
| 25 | Generic “more info on this” with no course/referral context | If no explicit captured referral metadata exists, ask one short course clarification | Do not guess based on ad patterns or most popular course |
| 30 | Menu/language/course list/registration form: courses, list, enrol, register, form; الدورات، القائمة، التسجيل، النموذج | Existing Guided/domain script using live courses and the published registration URL | Ask which course only if the first message/history has not identified it |
| 40 | Course fee/duration/date: price, fee, cost, how long, when, next batch; رسوم، سعر، مدة، متى، الدفعة | Live fact lookup; return current fee/duration; missing schedule always goes to staff | Use course already named in first message/session; never invent a date or discount |
| 40 | Location/hours/refund-policy question | Exact approved bilingual FAQ or live business profile | No follow-up if answered |
| 50 | Open-ended course suitability/details | Hybrid AI with only the relevant approved facts and a bounded recent-conversation summary | One useful question at most |
| 60 | Unclear, conflicting, or unsupported request | Ask one targeted clarification or hand off | No repeated generic greeting/menu |

Greeting-only opening copy (use only when the first inbound is just a greeting; never put this ahead of an ad-prefilled question):

- EN: “Welcome to Pro Catalyst Training Center. I can help with courses, current fees, registration, or our location. What would you like to know?”
- AR: “مرحباً بك في مركز برو كاتاليست للتدريب. يمكنني مساعدتك بمعلومات الدورات والرسوم الحالية والتسجيل وموقع المركز. ما الذي تود معرفته؟”

Copy-ready bilingual scripts and FAQ replies for the existing editor:

| Priority | Trigger/alias | English reply | Arabic reply | Action |
|---:|---|---|---|---|
| 5 | `hi`, `hello`, `salam`; مرحباً، السلام عليكم | Use the opening copy above. | Use the opening copy above. | Start the existing guided menu/Flow Builder opening once; do not request a name before the customer asks to register. |
| 20 | `courses`, `course list`, `show courses`; الدورات، قائمة الدورات | “Here are our current courses. Which one would you like to know about?” | “إليك قائمة دوراتنا الحالية. ما الدورة التي تود معرفة المزيد عنها؟” | Render the live course list; one optional course question. |
| 30 | `fee`, `price`, `cost`, `how much`; رسوم، سعر، كم التكلفة | “The current fee for {course} is {live_fee}.” | “الرسوم الحالية لدورة {course} هي {live_fee}.” | If first message/session names one course, resolve it directly; clarify only if no course is identified or several match. |
| 30 | `duration`, `how long`; مدة، كم تستغرق | “{course} takes {published_duration}.” | “مدة دورة {course} هي {published_duration}.” | Use live structured duration, except a published description range takes precedence; missing data goes to staff. Reuse selected course. |
| 30 | `next batch`, `start date`, `when`; الدفعة القادمة، موعد البداية، متى | “I don’t have a confirmed start date for the next batch. I’ll ask our team to confirm it for you.” | “لا يتوفر لدي موعد مؤكد لبدء الدفعة القادمة. سأطلب من فريقنا تأكيد الموعد لك.” | Pause automation and create the existing Inbox handoff. |
| 20 | `register`, `enrol`, `application form`; تسجيل، التحاق، نموذج التسجيل | “You can register using our Student Registration Form: https://7network.live/p/pro-catalyst-05f1f2b34f/forms/student-registration” | “يمكنك التسجيل عبر استمارة تسجيل الطالب: https://7network.live/p/pro-catalyst-05f1f2b34f/forms/student-registration” | Send only in response to a registration request; do not claim a submission is complete. |
| 40 | `more details`, `more information`; تفاصيل أكثر، معلومات أكثر | “{course}: {short published description}. The current fee is {live_fee}.” | “{course}: {short published description}. الرسوم الحالية {live_fee}.” | If first message names one course, answer from its live card; otherwise ask one focused clarification. |
| 0 | `person`, `agent`, `staff`, `talk to a human`; أريد موظفاً، أريد التحدث مع شخص | “I’ll ask our team to help you here.” | “سأطلب من فريقنا مساعدتك هنا.” | Pause the bot and hand off to Inbox immediately. |

The location/hours and MS Office duration FAQs already saved in production should be retained. Do not add static discount, refund, accreditation, payment, employment or student-account claims until the owner approves their policy text; route those intents to staff meanwhile.

No separate custom Flow Builder `introFlowId` was saved. The built-in Training Center guide supplies bilingual greetings, and the deployed first-message dispatcher handles course-bearing openers before choosing a script, fact lookup, Hybrid answer, clarification, or handoff. Enquiry capture uses the existing published registration form only after the customer requests registration; staff handoff uses the existing Inbox task/assignment path.

The live owner mapping has one active QR WhatsApp instance and no separate Meta channel record. The Hybrid profile is assigned to that existing QR instance. Historical message rows retained no referral IDs, so those old openers cannot be associated with specific campaigns; the deployed Meta webhook now carries bounded ad headline/body/URL and click ID fields on future inbound messages when Meta supplies them. Generic “this” is resolved from those fields only when exactly one published course matches. Do not create a new connection or use a personal staff channel.

## Cost and acceptance gates

The tenant provider setting is OpenAI `gpt-6-luna` with a 50,000-token daily cap. The provider credential is encrypted in the existing Business Profile setting and must never enter this file. Direct course facts and approved FAQ hits use zero generation tokens; AI receives relevant facts, redacted text, and no more than four recent turns summarized to at most 700 characters. A pre-activation production read on 2 November found 3,434 tokens in the tenant's daily usage ledger with zero reserved tokens and six `chatbot.preview-tested` events; it had no `chatbot.turn-measured` events or live bot turns. Those historical daily tokens cannot be allocated to individual previews. Source commit `09b8bfef` records safe provider/model/token/latency/route metrics for future preview requests, never prompt or answer text. New owner-preview comparison (2 November): Luna used 1,728 input + 101 output tokens in English (estimated $0.0002233) and 2,079 + 155 in Arabic ($0.0002854); Sol used 2,076 + 139 in Arabic ($0.005542). Both provided an appropriate course-fit recommendation; Luna was about 19x cheaper at the UI's displayed prices. The active profile remains on Luna. Continue checking provider failure, missing batch dates, mixed language, unclear messages, staff requests, and live token/handoff metrics during the restricted pilot.

## Current restricted pilot state — 2 November 2026

Authenticated production readback confirms the Hybrid profile is `live`, assigned to the one connected QR, and restricted to six unique owner/manager/agent test recipients. The user-provided test number duplicates an active staff number and is included once; the accountant was excluded as directed. Handoff tasks and handed-off Inbox conversations are assigned to the account owner because Team Access currently grants no team member access to this QR. Three active bilingual FAQs cover location/hours, the owner-confirmed MS Office duration (8–10 weeks), and registration. The bot is active, but actual WhatsApp inbound/reply delivery, owner Inbox handoff delivery, provider failure in the live path, and live usage metrics remain unverified. See the latest `DEPLOYMENT.md` entry for activation evidence and the protected rollback note reference.

### Read-only post-activation message check — 2 November 2026

The profile was saved live at `2026-11-02T11:34:57.771Z`. A tenant-scoped aggregate recheck after that saved time found zero `beta_conversation` rows for the verified Pro Catalyst owner/manager legacy UID links, zero chatbot turns (sent, handed off or failed), and zero `chatbot.turn-measured` usage events. This confirms no post-activation chat or bot reply was available to review at the check time; it does not prove delivery behavior. The prior 4,037-row/642-chat transcript analysis remains a pre-activation baseline. Continue using only explicitly human-attributed outbound messages as staff examples, and review actual new chats after the authorized test begins.

At activation, a fresh role-scoped roster read found seven phone-bearing memberships and six distinct staff numbers because the manager and one agent share a number. The owner-provided test number matched an active agent contact, so it is included once and does not increase the audience; keep all phone values out of Git. The single active QR instance labeled `Leads` is assigned to the Hybrid bot; its legacy channel identity maps to the owner membership although the owner identified it as the manager-connected QR. The accountant was excluded as directed and had no phone on file. The six-number audience and channel assignment are saved. Do not expand the allowlist until live first-message replies, handoff delivery and usage are reviewed.
