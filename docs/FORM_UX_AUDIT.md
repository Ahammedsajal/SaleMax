# Source-maintained form and control audit

Inventory refreshed 2026-10-12 by `node scripts/audit-form-controls.cjs`.

The scan covers maintained HTML/JavaScript/TypeScript under `client/public` and `client/workspace-src`, excluding the hash-bundled React assets. It found **62 static form templates** and **341 static controls**. The course batch-language field now comes from a shared runtime builder, so its language select and optional custom-code input are listed separately below. Each listed field is identified by its `name`, `id`, data-field, accessible label or placeholder; controls created at runtime are listed separately by source line. Dynamic loops and generated catalogue options need runtime checks because static scans cannot count their rendered instances.

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

  - Line 58 · **editLead** · 13 control(s): input:title [text], input:contactName [text], input:contactEmail [email], input:mobile [text], select:stageKey, select:priority, select:ownerAgentId, input:nextFollowUpAt [datetime-local], select:contactOutcome, input:followUpRequired [checkbox], input:expectedValue [number], input:unlabelled [text], button:unlabelled
  - Line 78 · **newLead** · 5 control(s): select:contactId, select:stageKey, select:ownerAgentId, button:unlabelled, button:unlabelled
  - Line 90 · **settingsForm** · 13 control(s): input:enabled [checkbox], input:autoCaptureQr [checkbox], input:autoCaptureMeta [checkbox], select:qrEntryStage, select:metaEntryStage, select:interestedStage, select:unlabelled, button:unlabelled, input:unlabelled [text], button:unlabelled, button:addMetaAdsMessage, button:unlabelled, button:unlabelled
  - Line 90 · **newStage** · 2 control(s): input:title [text], button:unlabelled
  - Line 100 · **sale-review-form** · 17 control(s): select:offerId, select:batchId, input:learnerName [text], input:payerName [text], input:payerEmail [email], input:payerPhone [tel], input:invoiceEmail [email], input:price [text], input:registrationFee [text], input:discount [number], textarea:terms, input:dueDate [date], input:installmentAmount [number], button:unlabelled, button:sale-installment-add, input:confirmCurrentOfferAndPayer [checkbox], button:unlabelled
  - Line 111 · **sale-review-decision** · 3 control(s): input:reason [text], button:unlabelled, button:unlabelled

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

  - Line 101 · **sx-course-create** · 13 control(s): input:studentIdPrefix [text], input:code [text], input:durationValue [number], select:durationUnit, input:nameEn [text], input:nameAr [text], select:deliveryMode, input:price [number], input:registrationFee [number], textarea:descriptionEn, textarea:descriptionAr, button:unlabelled, button:sx-course-cancel
  - Line 152 · **sx-batch-edit** · 7 control(s): input:code [text], input:startsOn [date], input:endsOn [date], input:capacity [number], select:status, button:unlabelled, button:sx-batch-cancel-edit
  - Line 148 · **sx-course-edit** · 12 control(s): input:studentIdPrefix [text], input:expectedRevision [hidden], input:nameEn [text], input:nameAr [text], input:code [text], input:durationValue [number], select:durationUnit, select:deliveryMode, textarea:descriptionEn, textarea:descriptionAr, button:unlabelled, button:sx-course-publish
  - Line 148 · **sx-course-offer** · 3 control(s): input:price [number], input:registrationFee [number], button:unlabelled
  - Line 152 · **sx-course-batch** · 5 control(s): input:code [text], input:startsOn [date], input:endsOn [date], input:capacity [number], button:unlabelled
  - Line 184 · **sx-center-profile** · 10 control(s): input:revision [hidden], input:sx-profile-logo-file [file], button:sx-profile-logo-choose, button:sx-profile-logo-remove, textarea:aboutEn, textarea:aboutAr, select:reportChannel, input:reportDestination [text], button:sx-report-recipient-add, button:unlabelled

  Runtime field builders: line 41 createElement(select); line 41 field name difficultyLevel; line 148 `batchLanguageField()` for both batch forms; line 41 createElement(textarea). The language builder offers Arabic, English, Hindi, Urdu, Malayalam, Bengali, Nepali, Filipino, Tamil and French; “Other” preserves existing valid locale codes and reveals a validated custom-code field. Create and edit keep the existing server `language` contract.

### `client/public/training-finance.js`

  - Line 91 · **sx-invoice-filter** · 3 control(s): input:q [text], select:status, button:unlabelled
  - Line 102 · **sx-reminder-settings-form** · 3 control(s): input:enabled [checkbox], select:unlabelled, button:unlabelled
  - Line 132 · **sx-generator-settings** · 7 control(s): input:companyName [hidden], input:crNumber [hidden], input:address [hidden], input:invoicePrefix [hidden], textarea:footer, button:sx-generator-add-plan, button:unlabelled
  - Line 132 · **sx-generator-invoice** · 11 control(s): input:customerType [radio], input:customerType [radio], input:sx-generator-search [text], select:sx-generator-customer-select, input:customerName [text], input:customerPhone [text], input:customerEmail [email], textarea:customerAddress, select:courseId, select:paymentPlan, button:unlabelled
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

  - Line 59 · **sx-app-filter** · 4 control(s): input:search [search], input:from [date], input:to [date], button:unlabelled
  - Line 63 · **sx-form-editor** · 16 control(s): input:id [hidden], input:revision [hidden], input:slug [text], input:nameEn [text], input:nameAr [text], input:titleEn [text], input:titleAr [text], textarea:descriptionEn, textarea:descriptionAr, input:${key} [checkbox], input:unlabelled [checkbox], textarea:consentTextEn, textarea:consentTextAr, button:unlabelled, button:sx-form-publish, button:sx-form-preview

### `client/public/training-public-form.js`

  - Line 76 · **enquiry-form** · 6 control(s): input:lead-search [search], input:website [text], select:course_ids, input:${field.key} [${type}], input:consent [checkbox], button:submit-button

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

- Course setup now gives the student ID prefix and course code distinct labels. Batch scheduling no longer displays the unrelated student ID prefix field that its API ignored, preventing staff from entering data that would be silently discarded.

- Course create and offer-edit prices and registration fees use bounded QAR decimal number inputs (`min=0`, `max=999999999.99`, `step=0.01`). Creating a draft may still omit its price; the active-offer editor still requires one. This aligns browser input with the existing `moneyMinor` parser and server minor-unit limit without changing the API contract.

- Lead creation and manual invoice entry now use telephone-optimized controls (`type="tel"`, telephone input hints and browser autofill) while retaining the same editable phone values and backend payloads. The invoice field keeps its 40-character limit. Production acceptance verified the active release, healthy app and deployed asset hashes; no lead or invoice was submitted during this check.

- Finance payment, installment, credit, refund and dispute amounts now use positive QAR decimal number controls with a 0.01 step; the credit field retains its balance-derived maximum. This covers all six rendered `amount` inputs in the existing Finance flows while leaving references, dates, methods and explanatory notes in their appropriate text, date/time or select controls. API payload parsing and server validation are unchanged.

- Public course enquiries now render the supported scalar field catalogue safely instead of assuming every field has a hard-coded label. City, nationality, gender, graduation, enquiry source, course level, preferred study days and class time use bilingual native selects; registration-only student, signature, payment-plan and staff fields stay tied to the registration template for new forms. Existing selected fields remain available for removal while editing.
- The live enquiry form was checked in English and Arabic: name and mobile remain typed fields, while Courses of interest is a multi-select with all nine active courses and consent is a checkbox. The registration form was checked without submission: source, staff, nationality, gender, city, graduation, course, batch, payment plan, level, class days and class time are selections; student ID and level preview update from the selected course. Names, contact details, QID and addresses stay editable because they are individual applicant information.
- Registration review found the one-time payment option repeated the cadence awkwardly and duplicated “Pay in full.” Payment wording is now bilingual and natural, single-payment offers show only one choice, and the live summary reads “One payment.” The updated public registration form and app shell both load the cache-busted controls.
- Remaining work includes recovering the main React app source before field-level changes there, visual acceptance of enquiry forms with optional field combinations, structured support or safe migration guidance for legacy generic forms containing registration-only array fields, and page-by-page field/layout review of the remaining listed forms and roles/viewports.

- Source recovery was checked against the available remote branches and tracked files: this checkout has no matching source map or React application source, and `client/src` contains only the SIP adapter. The 5.2 MB generated bundle remains outside reliable field-by-field edits until its supported source/build inputs are recovered.

Remaining source forms should be reviewed page by page using this inventory; deploy and visual acceptance must follow release evidence in `DEPLOYMENT.md`.
