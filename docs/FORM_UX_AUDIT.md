# Source-maintained form and control audit

Inventory refreshed 2026-10-12 by `node scripts/audit-form-controls.cjs`.

The scan covers maintained HTML/JavaScript/TypeScript under `client/public` and `client/workspace-src`, excluding the hash-bundled React assets. It found **63 static form templates** and **348 static controls**. The course batch-language field now comes from a shared runtime builder, so its language select and optional custom-code input are listed separately below. Each listed field is identified by its `name`, `id`, data-field, accessible label or placeholder; controls created at runtime are listed separately by source line. Dynamic loops and generated catalogue options need runtime checks because static scans cannot count their rendered instances.

## Latest popup review — course creation

The production Add Course dialog was visually checked at desktop width. Its constrained centered shell, aligned field grid, internal scrolling and persistent action bar remained intact. Course names now lead the first section; an optional student ID prefix no longer adds a duplicate manual entry. Static format, level and payment choices remain native selects, while learner names and bilingual course copy remain editable. Production interaction confirmed a suggested course code, preserved a manually edited code across later name changes, and closed the form without saving. The catalogue still showed 15 courses afterward.

## Lead Reports filters and report schedules — production, 12 October 2026

The authenticated Lead Reports page was reviewed after fixing its production journey-report failure. The report filter keeps period as a three-option select, the report date as a date control, and the Run report action aligned in one row. Schedule forms use the IANA timezone catalogue and native time, delivery-option and pause controls. The visible period and date controls are compact and aligned; no free-text fields are needed for these choices. The journey overview, cohort funnel, agent performance and finance summary rendered successfully. No report or schedule settings were changed. The backend UID join fix and runtime proof are recorded in `DEPLOYMENT.md`.

## Finance — invoice creation popup, production, 12 October 2026

The invoice builder defaults to the existing Leads & Contacts directory, searches by name/phone/email and then selects a matching record. Course and saved payment plan values come from catalogues; nine active courses and four saved plans were visible. Manual customer entry and manually dated installment schedules remain available only as fallbacks for cases without a matching contact or standard payment plan. The optional invoice footer and owner-maintained plan names/counts/intervals remain free-form settings because they are business-specific. The old invoice-policy panel is absent; the live page labels issued invoices with balances as “Invoices awaiting collection.”

The settings disclosure initially revealed a long form with plan inputs wrapping into several rows and oversized Remove controls. The plans now display as compact bordered rows on desktop, with two columns at narrower widths; field labels, inputs and actions stay aligned. The modal retains its internal scroll for the full settings and invoice workflow. Production review covered the expanded settings at desktop width and closed the popup without saving. Mobile visual verification remains open. The CSS release evidence is in `DEPLOYMENT.md`.

Finance Reports uses date controls for invoice issue range, a five-option aging-period select, and a free-text search for matching invoice/learner/payer details. Apply and Clear actions stay in the same aligned filter row at desktop width. The rendered report totals, aging table and empty-state loaded successfully; no filters or finance data were changed. Search remains text because it matches several independent identifiers.

## FAQ library — bilingual Add/Edit popup, production, 12 October 2026

The authenticated FAQ Add FAQ dialog previously placed all four bilingual fields in one vertical column and inherited a global dialog rule that pinned it to the top-left corner. English and Arabic question/answer pairs now sit in separate language panels on desktop and stack on phones. The dialog is explicitly centered, constrained to the viewport, scrollable when needed, and keeps its actions visible. English controls use left-to-right direction; Arabic controls use right-to-left direction. The four question/answer fields remain free text because these are business-authored, open-ended words rather than values from a finite catalogue. Existing field names and FAQ API payloads are unchanged.

Production visual checks covered English at 1036×906 and Arabic at 390×844. The dialog was centered at desktop size and within the mobile viewport; both locale panels, all four fields and the action buttons were visible, with the expected English/Arabic directions. The blank editor was canceled in each language. The existing FAQ list was not edited, and no FAQ was saved. Asset hashes, release and rollback evidence are recorded in `DEPLOYMENT.md`.

## Candidate Applications — registration editor and published form

The authenticated production editor was reviewed without saving or publishing. English/Arabic name, headline and description fields pair in aligned columns; the long field chooser is a two-column card grid. The current registration draft still contains a selected legacy combined course-details field alongside the newer structured course, batch and payment fields; this existing business configuration was left untouched. The public registration form renders all 9 active courses and uses catalogue-backed selects for course, batch, payment plan, level, class days and class time. Applicant names, addresses and contact details remain editable. Nationality was also a select, but its 90-country list omitted valid options including Egypt and Ethiopia.

The maintained registration control now offers all 249 ISO 3166-1 alpha-2 country/territory entries plus Kosovo (250 choices), sorted by the selected language and labelled using the browser's English or Arabic region names. The saved nationality remains the established English display-name value for compatibility with existing applications. A focused regression test checks the 250-choice catalogue and English/Arabic rendering. Production acceptance verified the staff-capture form in English and Arabic: all 250 nationalities, all nine course choices, and course, batch, payment, level, class-day and time selections render; the Qatar city list now uses Arabic labels while preserving its canonical English option values. No live application was submitted.

## Latest visual defect review — invoice builder

The supplied Finance screenshot showed the manual customer fields while “Choose from Leads & Contacts” was selected, oversized radio controls, and a form that did not read as a focused popup. The runtime Finance stylesheet sets `.grid` to `display:grid`, which overrides the browser’s default hidden display behavior. The invoice modal stylesheet now explicitly honors hidden elements, radio choice labels have selected and keyboard-focus states, the focus trap skips controls inside hidden sections, and the customer fieldset’s extra closing tag is removed. This fix is deployed in release `invoice-builder-modal-e0057fa-20261012`; the served CSS and JavaScript hashes are recorded in `DEPLOYMENT.md`.

The focused source checks and authenticated English Finance browser check pass: manual fields stay hidden in contact mode and appear only after choosing manual entry; Escape closes the modal. No invoice or payment was created. The refreshed scan has 63 templates and 347 controls. Each still needs page-by-page layout review and field-level decisions about dropdowns, searchable options, sensible defaults, and fields that must remain free text.

## Lead Pipeline Add Lead and Student directory — production review, 12 October 2026

The Add Lead modal was visually checked in the authenticated English workspace. Its centered, internally scrollable dialog keeps the title full width and pairs contact/learner and phone/email fields; optional student details and qualification fields remain grouped in collapsible sections. Contact matching, pipeline stage, assigned agent, course interest, nationality, Qatar city, gender, graduation, enquiry purpose, contact preferences, start window, experience, payer relationship and follow-up urgency are finite selections. Applicant names, phone, email, QID, addresses, schedule, learning goal and referral details remain editable because they are individual or explanatory information. The nationality field previously had only about 60 choices. It now shares the complete 250-country/territory bilingual list used by registration, preserving the established English saved value and any legacy stored choice. Production displayed Egypt, Ethiopia, Western Sahara and the full catalogue after release; the Add Lead form was cancelled without creating a lead.

Pipeline Automation settings were also opened in the authenticated production workspace. The first inspection exposed a JavaScript `ReferenceError` that prevented the settings modal from opening. The deployed fix binds the already-loaded intent-keyword helper before initialization. The modal now displays its stage selectors, keyword suggestions and custom phrase input, capture options, and editable Meta opening-message textareas in an aligned scrollable layout. It was cancelled without saving, so no automation configuration was changed. Production UI verification and rollback details are in `DEPLOYMENT.md`; no schema or business-data changes were needed.

The sale-review form was opened from an existing synthetic QA lead without submitting it. Published course offers and optional batches are selected from catalogues; learner/payer contact data, agreed terms, discount and installment amounts stay editable where they are business-specific. Course price and registration fee are read-only output values and follow the selected offer. Changing the offer updated those values and the scheduled total in production. The form-level test and release record are in `DEPLOYMENT.md`.

The Students page was visually checked at desktop width. Its search field, enrollment-status selector, actions and empty state are aligned; the live directory contains zero enrollments, so student-profile, attendance and trainer forms are not reachable from live records without creating synthetic business data. The form-level audit for those workflows remains open.

Student-profile trainer assignment now uses distinct existing trainer names from the same tenant as native select options, while “Add another trainer…” reveals a required custom-name field for new staff and outside instructors. The existing endpoint and stored trainer-name value remain unchanged. Unit checks cover tenant scoping and the custom-entry branch. Production release is recorded in `DEPLOYMENT.md`; authenticated production still has zero enrollments, so the profile select awaits a naturally available record for live visual acceptance. Attendance and the other student-profile controls still need separate field and layout review.

## File-by-file inventory

### `client/public/admin-actions.js`

  - Line 27 · **unnamed form** · 2 control(s): button:unlabelled, button:unlabelled

### `client/public/admin-asterisk.js`

  - Line 72 · **unnamed form** · 14 control(s): input:ariBaseUrl [url], input:ariUsername [text], input:ariPassword [password], input:gatewayHost [text], input:gatewaySipPort [number], select:gatewaySipTransport, input:enabled [checkbox], button:unlabelled, textarea:PJSIP configuration preview, button:unlabelled, button:unlabelled, button:unlabelled, button:unlabelled, button:unlabelled

  Runtime field builders: line 100 createElement(select); line 104 createElement(input); line 105 createElement(select).

### `client/public/admin-plan-contracts.js`

  - Line 39 · **unnamed form** · 3 control(s): input:email [email], input:password [password], button:unlabelled
  - Line 46 · **unnamed form** · 3 control(s): input:code [text], input:recoveryCode [text], button:unlabelled
  - Line 52 · **unnamed form** · 2 control(s): input:saved [checkbox], button:unlabelled
  - Line 63 · **unnamed form** · 4 control(s): select:category, input:${role} [number], button:unlabelled, button:unlabelled
  - Line 67 · **unnamed form** · 1 control(s): button:unlabelled

### `client/public/admin-plan-editor.js`

  - Line 60 · **unnamed form** · 5 control(s): textarea:short_description, select:is_trial, input:${name} [checkbox], button:unlabelled, button:unlabelled

### `client/public/admin-platform-staff.js`

  - Line 80 · **unnamed form** · 4 control(s): input:name [text], input:password [password], input:confirm [password], button:unlabelled
  - Line 96 · **sx-staff-card sx-staff-fields** · 4 control(s): input:email [email], input:password [password], button:unlabelled, button:unlabelled
  - Line 107 · **sx-staff-card** · 4 control(s): input:code [text], input:recoveryCode [text], button:unlabelled, button:unlabelled
  - Line 125 · **unnamed form** · 4 control(s): input:email [email], select:platformRole, select:reportsToIdentityId, button:unlabelled
  - Line 135 · **sx-staff-card** · 2 control(s): input:active [checkbox], button:unlabelled

  Runtime field builders: line 121 createElement(textarea).

### `client/public/admin-signin-mfa.js`

  - No literal form template; controls are created at runtime.

  Runtime field builders: line 51 createElement(input); line 63 createElement(form); line 63 createElement(input); line 63 field name code.

### `client/public/admin-telephony.js`

  - Line 47 · **unnamed form** · 6 control(s): input:ariBaseUrl [url], input:ariUsername [text], input:ariPassword [password], input:enabled [checkbox], button:unlabelled, button:unlabelled
  - Line 74 · **unnamed form** · 7 control(s): input:name [text], input:host [text], input:port [number], select:transport, input:enabled [checkbox], button:unlabelled, button:unlabelled

### `client/public/admin-user-plans.js`

  - Line 43 · **unnamed form** · 5 control(s): input:businessName [text], select:categoryKey, input:${role} [number], button:unlabelled, button:unlabelled
  - Line 58 · **unnamed form** · 5 control(s): select:version, input:${role} [number], button:unlabelled, button:unlabelled, button:unlabelled
  - Line 120 · **unnamed form** · 4 control(s): select:planId, button:unlabelled, button:unlabelled, button:unlabelled

### `client/public/agent-transfer-controls.js`

  - No literal form template; controls are created at runtime.

  Runtime field builders: line 23 createElement(form); line 26 createElement(select).

### `client/public/call-center/call-center.js`

  - No literal form template; controls are created at runtime.

  Runtime field builders: line 32 createElement(input); line 70 createElement(input); line 71 createElement(select); line 72 createElement(input); line 73 createElement(input); line 75 createElement(input); line 155 createElement(input).

### `client/public/call-center/index.html`

  - Line 32 · **outgoingForm** · 3 control(s): input:destination [tel], select:callClientType, button:placeCall

### `client/public/chatbot-admin.js`

  - Line 560 · **unnamed form** · 5 control(s): input:name [text], select:aiFallback, input:aiDataProcessingConfirmed [checkbox], button:unlabelled, button:unlabelled

### `client/public/optional-features.js`

  - No literal form template; controls are created at runtime.

  Runtime field builders: line 40 createElement(form); line 41 createElement(input).

### `client/public/pipeline/pipeline.js`

  - Line 60 · **editLead** · 13 control(s): input:title [text], input:contactName [text], input:contactEmail [email], input:mobile [tel], select:stageKey, select:priority, select:ownerAgentId, input:nextFollowUpAt [datetime-local], select:contactOutcome, input:followUpRequired [checkbox], input:expectedValue [number], input:unlabelled [text], button:unlabelled
  - Line 81 · **newLead** · 5 control(s): select:contactId, select:stageKey, select:ownerAgentId, button:unlabelled, button:unlabelled
  - Line 96 · **settingsForm** · 13 control(s): input:enabled [checkbox], input:autoCaptureQr [checkbox], input:autoCaptureMeta [checkbox], select:qrEntryStage, select:metaEntryStage, select:interestedStage, select:unlabelled, button:unlabelled, input:unlabelled [text], button:unlabelled, button:addMetaAdsMessage, button:unlabelled, button:unlabelled
  - Line 96 · **newStage** · 2 control(s): input:title [text], button:unlabelled
  - Line 107 · **sale-review-form** · 15 control(s): select:offerId, select:batchId, input:learnerName [text], input:payerName [text], input:payerEmail [email], input:payerPhone [tel], input:invoiceEmail [email], input:discount [number], textarea:terms, input:dueDate [date], input:installmentAmount [number], button:unlabelled, button:sale-installment-add, input:confirmCurrentOfferAndPayer [checkbox], button:unlabelled; 2 read-only values: output:data-sale-course-price, output:data-sale-registration-fee
  - Line 117 · **sale-review-decision** · 3 control(s): input:reason [text], button:unlabelled, button:unlabelled

### `client/public/pipeline/reports.js`

  - Line 90 · **reportFilters** · 3 control(s): select:period, input:at [date], button:unlabelled
  - Line 109 · **report-schedule-card** · 8 control(s): input:period [hidden], input:expectedRevision [hidden], select:timezone, input:localTime [time], input:emailEnabled [checkbox], input:whatsappEnabled [checkbox], input:paused [checkbox], button:unlabelled
  - Line 248 · **taskFilters** · 2 control(s): select:period, button:unlabelled
  - Line 252 · **followup-reschedule** · 2 control(s): input:at [datetime-local], button:unlabelled

  Runtime field builders: line 217 createElement(textarea).

### `client/public/tasks/index.html`

  - Line 15 · **taskForm** · 10 control(s): button:Close, input:title [text], textarea:description, select:taskType, select:priority, input:dueAt [datetime-local], button:unlinkFinanceSource, select:leadId, button:unlabelled, button:unlabelled
  - Line 26 · **preferencesForm** · 4 control(s): button:Close, input:whatsappOptIn [checkbox], button:unlabelled, button:unlabelled

### `client/public/tasks/tasks.js`

  - Line 1 · **chatForm** · 2 control(s): input:body [text], button:unlabelled

### `client/public/team-invitations.js`

  - Line 156 · **sx-role-form** · 6 control(s): input:id [hidden], input:name [text], select:seatRole, input:description [text], button:unlabelled, button:sx-role-reset
  - Line 156 · **sx-team-form** · 6 control(s): input:email [email], select:assignment, input:temporaryPassword [password], input:displayName [text], input:mobile [tel], button:unlabelled
  - Line 337 · **sx-accept-form** · 4 control(s): input:displayName [text], input:mobile [tel], input:password [password], button:unlabelled

### `client/public/training-center-profile.js`

  - Line 19 · **sx-center-profile** · 4 control(s): input:revision [hidden], textarea:aboutEn, textarea:aboutAr, button:unlabelled

### `client/public/training-courses.js`

  - Line 102 · **sx-course-create** · 13 control(s): input:studentIdPrefix [hidden], input:nameEn [text], input:nameAr [text], input:code [text], input:durationValue [number], select:durationUnit, select:deliveryMode, input:price [number], input:registrationFee [number], textarea:descriptionEn, textarea:descriptionAr, button:unlabelled, button:sx-course-cancel
  - Line 156 · **sx-batch-edit** · 7 control(s): input:code [text], input:startsOn [date], input:endsOn [date], input:capacity [number], select:status, button:unlabelled, button:sx-batch-cancel-edit
  - Line 156 · **sx-course-edit** · 12 control(s): input:studentIdPrefix [text], input:expectedRevision [hidden], input:nameEn [text], input:nameAr [text], input:code [text], input:durationValue [number], select:durationUnit, select:deliveryMode, textarea:descriptionEn, textarea:descriptionAr, button:unlabelled, button:sx-course-publish
  - Line 156 · **sx-course-offer** · 3 control(s): input:price [number], input:registrationFee [number], button:unlabelled
  - Line 156 · **sx-course-batch** · 5 control(s): input:code [text], input:startsOn [date], input:endsOn [date], input:capacity [number], button:unlabelled
  - Line 192 · **sx-center-profile** · 10 control(s): input:revision [hidden], input:sx-profile-logo-file [file], button:sx-profile-logo-choose, button:sx-profile-logo-remove, textarea:aboutEn, textarea:aboutAr, select:reportChannel, input:reportDestination [text], button:sx-report-recipient-add, button:unlabelled

  Runtime field builders: line 41 createElement(select); line 41 field name difficultyLevel; line 41 createElement(textarea).

### `client/public/training-faqs.js`

  - Line 37 · **sx-faq-form** · 7 control(s): button:${tr('Close','إغلاق')}, input:questionEn [text], textarea:answerEn, input:questionAr [text], textarea:answerAr, button:unlabelled, button:unlabelled

### `client/public/training-finance.js`

  - Line 91 · **sx-invoice-filter** · 3 control(s): input:q [text], select:status, button:unlabelled
  - Line 102 · **sx-reminder-settings-form** · 3 control(s): input:enabled [checkbox], select:unlabelled, button:unlabelled
  - Line 132 · **sx-generator-settings** · 7 control(s): input:companyName [hidden], input:crNumber [hidden], input:address [hidden], input:invoicePrefix [hidden], textarea:footer, button:sx-generator-add-plan, button:unlabelled
  - Line 132 · **sx-generator-invoice** · 11 control(s): input:customerType [radio], input:customerType [radio], input:sx-generator-search [text], select:sx-generator-customer-select, input:customerName [text], input:customerPhone [tel], input:customerEmail [email], textarea:customerAddress, select:courseId, select:paymentPlan, button:unlabelled
  - Line 164 · **sx-aging-filter** · 6 control(s): input:from [date], input:to [date], select:bucket, input:q [text], button:unlabelled, button:sx-aging-clear
  - Line 198 · **sx-payment-form** · 6 control(s): input:amount [number], select:method, input:receivedAt [datetime-local], input:reference [text], input:note [text], button:unlabelled
  - Line 224 · **sx-schedule-change-form** · 5 control(s): input:dueDate [date], input:amount [number], button:sx-schedule-add-row, textarea:reason, button:unlabelled
  - Line 231 · **sx-credit-form** · 3 control(s): input:amount [number], textarea:reason, button:unlabelled
  - Line 268 · **unnamed form** · 3 control(s): textarea:reason, button:decision, button:decision
  - Line 268 · **unnamed form** · 5 control(s): select:method, input:reference [text], input:completedAt [datetime-local], input:confirmed [checkbox], button:unlabelled
  - Line 268 · **unnamed form** · 4 control(s): select:paymentId, input:amount [number], textarea:reason, button:unlabelled
  - Line 283 · **unnamed form** · 3 control(s): select:decision, textarea:reason, button:unlabelled
  - Line 283 · **unnamed form** · 5 control(s): select:paymentId, input:amount [number], input:reference [text], textarea:reason, button:unlabelled
  - Line 291 · **unnamed form** · 3 control(s): select:decision, textarea:reason, button:unlabelled

  Runtime field builders: line 186 createElement(input); line 194 createElement(input).

### `client/public/training-forms.js`

  - Line 60 · **sx-app-filter** · 4 control(s): input:search [search], input:from [date], input:to [date], button:unlabelled
  - Line 64 · **sx-form-editor** · 16 control(s): input:id [hidden], input:revision [hidden], input:slug [text], input:nameEn [text], input:nameAr [text], input:titleEn [text], input:titleAr [text], textarea:descriptionEn, textarea:descriptionAr, input:${key} [checkbox], input:unlabelled [checkbox], textarea:consentTextEn, textarea:consentTextAr, button:unlabelled, button:sx-form-publish, button:sx-form-preview

### `client/public/training-public-form.js`

  - Line 139 · **enquiry-form** · 8 control(s): input:lead-search [search], input:website [text], input:search [search], input:course_ids [checkbox], select:${esc(field.key)}, input:${field.key} [${type}], input:consent [checkbox], button:submit-button

### `client/public/training-students.js`

  - Line 36 · **sx-st-trainer-form** · 2 control(s): input:trainerName [text], button:unlabelled
  - Line 36 · **sx-st-attendance-form** · 4 control(s): input:sessionDate [date], select:status, input:note [text], button:unlabelled

## Review rules for dropdown conversion

- Use dropdowns or searchable selects for finite, validated catalogues already owned by the business: course, batch, payment plan, lifecycle status, role, channel, and fixed decision/outcome values.
- Keep names, phone numbers, email, addresses, references, free-form explanations and bilingual course copy editable. Offer input hints or safe saved values where useful; do not force an incomplete list.
- Use date, time, number, checkbox and radio controls for their real data types. Replace comma-delimited list entry with individual controls only when the backend accepts an explicit bounded set.
- For very long catalogues, use a searchable select backed by tenant-scoped APIs and preserve current form validation, permission checks, RTL labels and keyboard access.

## Visual evidence and limits

The supplied current-run screenshot documents the Finance invoice builder before its modal and alignment update. The source inventory is broad but does not prove the rendered appearance of every screen, role, viewport or language. The hash-bundled primary React application is intentionally excluded from source edits; shared styling can improve it, while field-by-field changes there require recoverable source or a supported build input.

The core UI bundle is tracked at `client/public/static/js/main.73648acf.js` (about 5.2 MB), but this checkout has no matching source map or React application source tree; `client/src` currently contains only the SIP call-center adapter. The bundle is minified and builds controls through generated runtime code, so it cannot be reliably audited or maintained field by field from this artifact alone. Recover the original React source/build input before claiming the entire application has received a field-by-field audit.

## Work completed in this audit increment

- Finance invoice creation is presented as a centered, constrained modal with a dimmed backdrop, keyboard Escape close, initial focus, focus trapping, and focus return to the opener.
- The lead/contact details stay hidden until a valid contact is selected; changing the search clears the previous contact identity so an old selection cannot silently be invoiced.
- Manual customer entry stays available, and shared native form controls receive consistent sizing and visible keyboard focus.
- Installment reminders use a guided offset picker spanning the server-approved range (-30 through +90 days), with removable selected-date chips and the server limit of eight dates; staff no longer type comma-separated values.
- Scheduled report time zones are chosen from the complete browser IANA list, with Qatar and nearby Gulf locations at the top; the selected value is styled to match adjacent form controls.
- Pipeline intent keywords use bilingual suggested choices and removable chips with an optional custom phrase; the existing backend array contract and 30-phrase limit are preserved.
- Candidate Applications was visually checked in the authenticated business workspace. The editor had English and Arabic name/title/description fields flowing into mismatched rows, and its long field checklist consumed excess vertical space. The editor now pairs each English and Arabic copy side by side on desktop, stacks them in order on phones, and presents selectable fields as a responsive two-column card grid with clearer focus outlines. Catalogue-backed course, batch and payment-plan choices remain selects; free-form personal details remain editable.

- Course batch creation and editing now use a bilingual language select for common Qatar training-center languages, with an “Other” option that preserves existing valid locale codes and reveals a validated custom-code field. API payloads keep the existing `language` contract. Focused UI-contract tests cover common/custom selections and both create/edit submission paths.

- Course creation now requests learner-facing English and Arabic names before the course code. The code is suggested from the English name with a collision-reducing suffix and remains editable; later name edits do not overwrite a manually edited code. The create screen no longer asks for the optional student ID prefix, which defaults to the course code during registration. Existing course editing still allows staff to change that prefix. The authenticated production popup verified both generated suggestions and manual override behavior without saving a draft.

- Course create and offer-edit prices and registration fees use bounded QAR decimal number inputs (`min=0`, `max=999999999.99`, `step=0.01`). Creating a draft may still omit its price; the active-offer editor still requires one. This aligns browser input with the existing `moneyMinor` parser and server minor-unit limit without changing the API contract.

- Lead creation and manual invoice entry now use telephone-optimized controls (`type="tel"`, telephone input hints and browser autofill) while retaining the same editable phone values and backend payloads. The invoice field keeps its 40-character limit. Production acceptance verified the active release, healthy app and deployed asset hashes; no lead or invoice was submitted during this check.
- Lead qualification course interest now comes from the tenant-scoped active-course catalogue, paginated at the supported 100-item limit. Names are localized and shown with course codes; “Another course / not listed” reveals a custom-name field. The selected catalogue ID is translated to the canonical course name before saving through the existing string field. Production returned and displayed all 9 active courses; the custom and catalogue paths were checked without creating a lead.

- Finance payment, installment, credit, refund and dispute amounts now use positive QAR decimal number controls with a 0.01 step; the credit field retains its balance-derived maximum. This covers all six rendered `amount` inputs in the existing Finance flows while leaving references, dates, methods and explanatory notes in their appropriate text, date/time or select controls. API payload parsing and server validation are unchanged.

- Public course enquiries now render the supported scalar field catalogue safely instead of assuming every field has a hard-coded label. City, nationality, gender, graduation, enquiry source, course level, preferred study days and class time use bilingual native selects; registration-only student, signature, payment-plan and staff fields stay tied to the registration template for new forms. Existing selected fields remain available for removal while editing.
- The live enquiry form was checked in English and Arabic: name and mobile remain typed fields, while Courses of interest is a multi-select with all nine active courses and consent is a checkbox. The registration form was checked without submission: source, staff, nationality, gender, city, graduation, course, batch, payment plan, level, class days and class time are selections; student ID and level preview update from the selected course. Names, contact details, QID and addresses stay editable because they are individual applicant information.
- Registration review found the one-time payment option repeated the cadence awkwardly and duplicated “Pay in full.” Payment wording is now bilingual and natural, single-payment offers show only one choice, and the live summary reads “One payment.” The updated public registration form and app shell both load the cache-busted controls.
- The staff registration capture now shares the same 250-country nationality helper as generic public forms. Country values remain canonical English names, labels follow the selected language, and Western Sahara is explicitly localized in both languages to avoid the raw `EH` region code. The cache-busted `20261012-nationalities3` release was checked live in English and Arabic; all nine active courses remained available, the public page and asset returned successfully, and no form was submitted. Focused coverage asserts the complete nationality list in both generic and staff-capture paths. Deployment hashes and rollback details are recorded in `DEPLOYMENT.md`.
- Public course enquiry interest uses a searchable, collapsible multi-select with all nine active courses, clear selected-count/name feedback, and regular-sized checkboxes. Production checks selected two courses and confirmed their names and count without entering personal details or submitting the form. Focused form/registration checks pass 16/16; release and rollback evidence are in `DEPLOYMENT.md`.
- Student attendance now caps its date picker using Qatar local time (`Asia/Qatar`) instead of the browser’s UTC date, so the date input agrees with the existing server validation after UTC midnight near the Qatar day boundary. A regression test exercises that rollover with a fixed clock. The cache-busted Courses loader and student script were byte-verified from production and pass syntax checks; no attendance record was submitted. Full in-session entry testing remains part of the page-by-page review.
- Remaining work includes recovering the main React app source before field-level changes there, visual acceptance of enquiry forms with optional field combinations, structured support or safe migration guidance for legacy generic forms containing registration-only array fields, and page-by-page field/layout review of the remaining listed forms and roles/viewports.

- Source recovery was checked against the available remote branches and tracked files: this checkout has no matching source map or React application source, and `client/src` contains only the SIP adapter. The 5.2 MB generated bundle remains outside reliable field-by-field edits until its supported source/build inputs are recovered.

Remaining source forms should be reviewed page by page using this inventory; deploy and visual acceptance must follow release evidence in `DEPLOYMENT.md`.

## Candidate Applications editor — production, 12 October 2026

The existing course-enquiry form has 26 configurable field rows, a link slug, and bilingual name, headline, description and consent-copy controls. Its field checklist is configuration, so those rows stay checkboxes rather than becoming text inputs or catalogue selects; the bilingual copy remains editable. Before this change, the editor card was about 1,369 px tall in a 906 px viewport and its actions sat below the screen. Release `form-editor-scroll-a80b665-20261012` bounds the editor card to the available height, scrolls the form internally, keeps Save/Publish/Preview sticky and hides the repeated Candidate Applications heading only while editing.

Production review opened the published course-enquiry draft in English and Arabic and canceled it unchanged. At 1036×906 and 390×844, the card and actions remained within the viewport; all 26 field rows remained available; scrolling reached both consent-copy fields while the actions stayed visible; and the page had no horizontal overflow. The authenticated form and submission-list GET requests returned 200. No draft was saved or published. The editor asset hashes, release and rollback details are recorded in `DEPLOYMENT.md`.

## Team Access — production, 12 October 2026

The Team Access page has role creation/editing and staff invitation forms plus per-member sidebar-access settings. The reviewed controls are: role name and optional description (free text), seat type (fixed select), module permissions (API-provided checkboxes), email, optional password, full name and mobile (individual account data), role assignment (business role select), and sidebar navigation (API-provided checkboxes). Those values remain in their original controls and request payloads.

The role permission groups and each member's navigation groups now collapse into labeled sections. Every section shows its selected/available count, which updates immediately when a checkbox is changed; Save still collects all selected permissions, including those inside closed sections. This reduces the Team Members card from 5,103 px to 2,334 px at 1036×906 with the current tenant's nine member cards. The existing member and role forms do not need long checkbox lists expanded by default.

The audit also found the dashboard stores Arabic as `Lang-Arabic`, while Team Access only recognized values beginning with `ar`. Locale normalization now recognizes the actual saved value, so Team Access renders Arabic labels and RTL layout. Production was checked in English at 1036×906 and Arabic at 390×844; widths remained within the viewport, and both permission and navigation counters were toggled and restored without saving. No role, invitation or member navigation setting was submitted. Focused source tests passed 3/3. The page loaded tenant team data; the dashboard still logs 401 for `/api/user/business-auth/me` and 409 for `/api/user/call-center/status`.
