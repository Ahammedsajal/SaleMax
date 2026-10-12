# Source-maintained form and control audit

Inventory refreshed 2026-10-12 by `node scripts/audit-form-controls.cjs`.

The scan covers maintained HTML/JavaScript/TypeScript under `client/public` and `client/workspace-src`, excluding the hash-bundled React assets. The current inventory script found **62 static form templates** and **345 static controls**. Runtime-built controls, including the course batch-language select and optional custom-code input, are listed separately by source line. Each listed field is identified by its `name`, `id`, data-field, accessible label or placeholder. Dynamic loops and generated catalogue options need runtime checks because static scans cannot count their rendered instances. The inventory captures static button labels and translated labels when available. Read-only markers and output controls are identified in the inventory so derived values are not confused with fields staff can edit.

## Latest popup review — course creation

The production Add Course dialog was visually checked at desktop width. Its constrained centered shell, aligned field grid, internal scrolling and persistent action bar remained intact. Course names now lead the first section; an optional student ID prefix no longer adds a duplicate manual entry. Static format, level and payment choices remain native selects, while learner names and bilingual course copy remain editable. Production interaction confirmed a suggested course code, preserved a manually edited code across later name changes, and closed the form without saving. The catalogue still showed 15 courses afterward.

At 390×844, the same create dialog fills the phone viewport, keeps its close control and Save draft/Cancel actions visible, and scrolls the long set of sections internally. Text, bilingual descriptions, durations, prices, dates and files remain typed controls; duration unit, delivery mode, course level and payment frequency are selections. The active release showed no page-level horizontal overflow, and the empty draft was closed without saving. The 15-course catalogue was left unchanged.

## Course editor — production, 12 October 2026

The existing-course editor keeps bilingual names/descriptions, outcomes and prerequisites editable; the student ID prefix and course code are prefilled. Duration unit, delivery mode, course level, offer payment frequency and batch language are catalogue-backed selects. Prices, term counts, duration and seat capacity use numeric controls; batch dates use date pickers; supporting files use type-specific upload controls. The centered editor scrolls internally, bilingual fields align in two columns and section labels are clear. It was closed without saving.

This review found a source-data mismatch in the selected course: its description says the duration is 8–10 weeks, a QAR 250 starting payment and the balance in installments, while the structured fields leave duration unset and the active offer is QAR 850 as one payment with no registration fee. The editor cannot safely resolve that narrative/structured conflict automatically; confirm the course’s authoritative duration and payment terms before changing the record or using it as an AI answer source.

The live editor displayed `null null` for unset duration and delivery values. Release `course-editor-details-f3cff6d-20261012` now shows clear “Duration not set” and “Delivery not set” labels (localized in Arabic), and exposes editable English and Arabic prerequisites in the course editor. Create and edit payloads persist both prerequisite fields. Production browser verification confirmed the corrected header, bilingual prerequisite inputs and existing course content; no course data was saved or changed. The Add Course flow is covered by the same source-backed form implementation and focused UI tests.

## Lead Reports filters and report schedules — production, 12 October 2026

The authenticated Lead Reports page was reviewed after fixing its production journey-report failure. The report filter keeps period as a three-option select, the report date as a date control, and the Run report action aligned in one row. Schedule forms use the IANA timezone catalogue and native time, delivery-option and pause controls. The visible period and date controls are compact and aligned; no free-text fields are needed for these choices. The journey overview, cohort funnel, agent performance and finance summary rendered successfully. No report or schedule settings were changed. The backend UID join fix and runtime proof are recorded in `DEPLOYMENT.md`.

## Finance — invoice creation popup, production, 12 October 2026

The invoice builder defaults to the existing Leads & Contacts directory, searches by name/phone/email and then selects a matching record. Course and saved payment plan values come from catalogues; nine active courses and four saved plans were visible. Manual customer entry and manually dated installment schedules remain available only as fallbacks for cases without a matching contact or standard payment plan. The optional invoice footer and owner-maintained plan names/counts/intervals remain free-form settings because they are business-specific. The old invoice-policy panel is absent; the live page labels issued invoices with balances as “Invoices awaiting collection.”

The settings disclosure initially revealed a long form with plan inputs wrapping into several rows and oversized Remove controls. The plans now display as compact bordered rows on desktop, with two columns at narrower widths; field labels, inputs and actions stay aligned. The modal retains its internal scroll for the full settings and invoice workflow. Production review covered the expanded settings at desktop width and closed the popup without saving. Mobile review at 390×844 confirmed readable full-width plan names, side-by-side numeric controls, right-aligned Remove actions and stacked full-width Add/Save settings actions; the page did not overflow. The dialog was closed without saving, and release evidence is in `DEPLOYMENT.md`.

The invoice-builder action bar stays sticky on standard phone and desktop layouts. A 320×640 production check showed that this left the payment-plan selector beneath the bar at the initial scroll position. The bar now flows after the fields on very narrow or short viewports, while the modal remains internally scrollable. At 320×640 the selector and Generate action no longer overlap; at 390×844 the sticky footer remains visible and the selector stays above it. The preview was closed without creating an invoice; release and rollback evidence is recorded in `DEPLOYMENT.md`.

Finance Reports uses date controls for invoice issue range, a five-option aging-period select, and a free-text search for matching invoice/learner/payer details. Apply and Clear actions stay in the same aligned filter row at desktop width. The rendered report totals, aging table and empty-state loaded successfully; no filters or finance data were changed. Search remains text because it matches several independent identifiers.

## Students directory — production, 12 October 2026

The enrolled-student dashboard has a single search for name, phone, email or invoice, a six-state enrollment-status select, Search/Clear actions and Refresh. Its filter controls are aligned in one row at desktop width, while status is selected from the finite enrollment lifecycle rather than typed manually. Production currently has zero enrollments, so student detail, attendance and payment-profile forms could not be opened for live review; source-maintained fields remain in the static inventory above. No student or finance records were changed.

## FAQ library — bilingual Add/Edit popup, production, 12 October 2026

The authenticated FAQ Add FAQ dialog previously placed all four bilingual fields in one vertical column and inherited a global dialog rule that pinned it to the top-left corner. English and Arabic question/answer pairs now sit in separate language panels on desktop and stack on phones. The dialog is explicitly centered, constrained to the viewport, scrollable when needed, and keeps its actions visible. English controls use left-to-right direction; Arabic controls use right-to-left direction. The four question/answer fields remain free text because these are business-authored, open-ended words rather than values from a finite catalogue. Existing field names and FAQ API payloads are unchanged.

Production visual checks covered English at 1036×906 and Arabic at 390×844. The dialog was centered at desktop size and within the mobile viewport; both locale panels, all four fields and the action buttons were visible, with the expected English/Arabic directions. The blank editor was canceled in each language. The existing FAQ list was not edited, and no FAQ was saved. Asset hashes, release and rollback evidence are recorded in `DEPLOYMENT.md`.

## Candidate Applications — registration editor and published form

The authenticated production editor was reviewed without saving or publishing. English/Arabic name, headline and description fields pair in aligned columns; the long field chooser is a two-column card grid. The current registration draft still contains a selected legacy combined course-details field alongside the newer structured course, batch and payment fields; this existing business configuration was left untouched. The public registration form renders all 9 active courses and uses catalogue-backed selects for course, batch, payment plan, level, class days and class time. Applicant names, addresses and contact details remain editable. Nationality was also a select, but its 90-country list omitted valid options including Egypt and Ethiopia.

At 390×844, the new enquiry editor keeps its Save draft and Preview actions available while the bilingual copy and full field checklist scroll inside the editor card. Contact details and explanatory copy remain editable; the finite applicant field set is configured with checkboxes. New form slugs are now suggested from the English name and remain manually editable; existing draft slugs are preserved. Focused regression tests cover punctuation, short/non-Latin names, live suggestions and manual overrides. The test draft was closed without saving.

The maintained registration control now offers all 249 ISO 3166-1 alpha-2 country/territory entries plus Kosovo (250 choices), sorted by the selected language and labelled using the browser's English or Arabic region names. The saved nationality remains the established English display-name value for compatibility with existing applications. A focused regression test checks the 250-choice catalogue and English/Arabic rendering. Production acceptance verified the staff-capture form in English and Arabic: all 250 nationalities, all nine course choices, and course, batch, payment, level, class-day and time selections render; the Qatar city list now uses Arabic labels while preserving its canonical English option values. No live application was submitted.

## Latest visual defect review — invoice builder

The supplied Finance screenshot showed the manual customer fields while “Choose from Leads & Contacts” was selected, oversized radio controls, and a form that did not read as a focused popup. The runtime Finance stylesheet sets `.grid` to `display:grid`, which overrides the browser’s default hidden display behavior. The invoice modal stylesheet now explicitly honors hidden elements, radio choice labels have selected and keyboard-focus states, the focus trap skips controls inside hidden sections, and the customer fieldset’s extra closing tag is removed. This fix is deployed in release `invoice-builder-modal-e0057fa-20261012`; the served CSS and JavaScript hashes are recorded in `DEPLOYMENT.md`.

The focused source checks and authenticated English Finance browser check pass: manual fields stay hidden in contact mode and appear only after choosing manual entry; Escape closes the modal. No invoice or payment was created. The current scan has 62 literal form templates, 346 controls nested in those templates, and 108 additional input/select/textarea fragments outside literal form blocks. Some outside fragments are interpolated into generated forms, so the counts are an inventory aid rather than an additive count of rendered controls. Subsequent page-level reviews and changes are recorded below; runtime checks are still needed for generated forms, repeated rows, dynamic catalogue options, and controls in the bundled React application.

## Lead Pipeline Add Lead and Student directory — production review, 12 October 2026

The Add Lead modal was visually checked in the authenticated English workspace. Its centered, internally scrollable dialog keeps the title full width and pairs contact/learner and phone/email fields; optional student details and qualification fields remain grouped in collapsible sections. Contact matching, pipeline stage, assigned agent, course interest, nationality, Qatar city, gender, graduation, enquiry purpose, contact preferences, start window, experience, payer relationship and follow-up urgency are finite selections. Applicant names, phone, email, QID, addresses, schedule, learning goal and referral details remain editable because they are individual or explanatory information. The nationality field previously had only about 60 choices. It now shares the complete 250-country/territory bilingual list used by registration, preserving the established English saved value and any legacy stored choice. Production displayed Egypt, Ethiopia, Western Sahara and the full catalogue after release; the Add Lead form was cancelled without creating a lead.

Pipeline Automation settings were also opened in the authenticated production workspace. The first inspection exposed a JavaScript `ReferenceError` that prevented the settings modal from opening. The deployed fix binds the already-loaded intent-keyword helper before initialization. The modal now displays its stage selectors, keyword suggestions and custom phrase input, capture options, and editable Meta opening-message textareas in an aligned scrollable layout. It was cancelled without saving, so no automation configuration was changed. Production UI verification and rollback details are in `DEPLOYMENT.md`; no schema or business-data changes were needed.

The sale-review form was opened from an existing synthetic QA lead without submitting it. Published course offers and optional batches are selected from catalogues; learner/payer contact data, agreed terms, discount and installment amounts stay editable where they are business-specific. Course price and registration fee are read-only output values and follow the selected offer. Changing the offer updated those values and the scheduled total in production. The form-level test and release record are in `DEPLOYMENT.md`.

The Students page was visually checked at desktop width. Its search field, enrollment-status selector, actions and empty state are aligned; the live directory contains zero enrollments, so student-profile, attendance and trainer forms are not reachable from live records without creating synthetic business data. The form-level audit for those workflows remains open.

## Lead Pipeline existing-lead editor — phone input, production, 12 October 2026

The existing-lead editor now marks the mobile number as a telephone field and supplies telephone input, autofill and keyboard hints. The saved value, contact-linked/agent disabled rules and API payload are unchanged. The static inventory was corrected from `input:mobile [text]` to `input:mobile [tel]`. Production has zero leads, so I verified the deployed cache-busted asset and opened the Add Lead dialog without saving; the existing-lead editor itself remains unverified against a live record. No lead was created or changed.

Student-profile trainer assignment now uses distinct existing trainer names from the same tenant as native select options, while “Add another trainer…” reveals a required custom-name field for new staff and outside instructors. The existing endpoint and stored trainer-name value remain unchanged. Unit checks cover tenant scoping and the custom-entry branch. Production release is recorded in `DEPLOYMENT.md`; authenticated production still has zero enrollments, so the profile select awaits a naturally available record for live visual acceptance. Attendance and the other student-profile controls still need separate field and layout review.

## Student profile trainer and attendance forms — production CSS verification, 12 October 2026

The custom trainer-name label uses the HTML `hidden` attribute, but a more-specific `.sx-st-form label { display:grid }` rule overrides the browser's default hidden styling. The CSS now explicitly hides `[hidden]` controls, so the manual trainer-name field stays out of view until “Add another trainer…” is selected. Trainer assignment remains a saved-name select with an explicit custom-name path for new instructors. The attendance form now puts its three fields and Save action in one aligned desktop row, two columns on tablet, and a single column on phones; the trainer form similarly aligns its select and action, adapting when the custom-name field appears. The attendance note stays free text because it records a case-specific explanation. Regression checks cover the hidden-state rule, catalogue select/custom branch, and responsive layouts. A production-browser fixture loaded the deployed script's actual CSS and confirmed that the custom-name field is hidden then appears on explicit reveal, attendance uses four columns at 1440px, two at 768px and one at 390px, and the RTL phone layout has no horizontal overflow. The business-auth and student-list APIs returned 401; no live enrollment was available to open, and no student record was changed. Authenticated profile/attendance interaction remains pending a naturally available enrollment and normal business sign-in.

## Workspace sign-in and public customer actions — source audit

The maintained workspace sign-in builds its fields through a shared helper, which the old static scanner missed. It has a workspace slug, email and password at login; a six-digit authenticator code or recovery code in the challenge step; and a checkbox confirming recovery codes were saved. The tenant/platform audience is already a two-button choice. These values are credentials or identity inputs, so converting them to business-data dropdowns would be inappropriate; the password show/hide and correct email, numeric-code, and one-time-code hints are retained. This sign-in source is used by the isolated authentication lab; production replacement and real account acceptance remain open per `AUTHENTICATION_CONTRACT.md`.

The current production `/admin/login` is the compiled React page, not that maintained workspace sign-in. A 390×844 read-only review showed the email and password fields fit the viewport, but both are outside a native `<form>` and have no `name` or `autocomplete` attributes; the browser console reports the password-outside-form warning. Browser autofill was active in this session, so the populated values came from the browser, not the page source; no sign-in was submitted. The shipped 5.2 MB React bundle has no source map and its component source/build input is not present in this checkout. Correcting the login semantics safely requires recovering the supported React source/build, rather than patching the minified bundle as if it were maintained source.

The customer reminder-preference page has two explicit opt-in/opt-out actions and no text field. The customer document page displays invoice or receipt details without editable fields or dropdowns. Neither page benefits from a dropdown; their actions are deliberate yes/no choices or read-only document viewing.

## File-by-file inventory

### `client/public/admin-actions.js`

  - Line 27 · **unnamed form** · 2 control(s): button:Cancel, button:unlabelled
  Control fragments outside literal <form> markup (3; some are interpolated into generated forms): line 23 input:${name} [${type}]; line 24 input:${name} [checkbox]; line 37 select:planId

### `client/public/admin-asterisk.js`

  - Line 73 · **unnamed form** · 14 control(s): input:ariBaseUrl [url], input:ariUsername [text], input:ariPassword [password], input:gatewayHost [text], input:gatewaySipPort [number], output:SIP transport, input:enabled [checkbox], button:Save channel policies, textarea:data-preview-config [readonly], button:Preview PJSIP config, button:Apply Dinstar peer to Asterisk, button:Test ARI connection, button:Close, button:Save setup
  Control fragments outside literal <form> markup (6; some are interpolated into generated forms): line 89 textarea:Agent SIP and WebRTC endpoint preview [readonly]; line 90 textarea:Asterisk host setup preview [readonly]; line 91 textarea:Tenant dialplan preview [readonly]; line 108 input:data-enabled [checkbox]; line 108 input:data-inbound [checkbox]; line 108 input:data-outbound [checkbox]

  Runtime field builders: line 101 form/control helper creates select; line 105 form/control helper creates input; line 106 form/control helper creates select.

### `client/public/admin-plan-contracts.js`

  - Line 39 · **unnamed form** · 3 control(s): input:email [email], input:password [password], button:Verify access
  - Line 46 · **unnamed form** · 3 control(s): input:code [text], input:recoveryCode [text], button:Confirm verification
  - Line 52 · **unnamed form** · 2 control(s): input:saved [checkbox], button:Continue
  - Line 63 · **unnamed form** · 5 control(s): output:Business category, input:${role} [number], input:capability [checkbox], button:Create contract draft, button:Cancel editing
  - Line 67 · **unnamed form** · 1 control(s): button:Publish reviewed version
  Control fragments outside literal <form> markup (1; some are interpolated into generated forms): line 52 textarea:Recovery codes [readonly]

### `client/public/admin-plan-editor.js`

  - Line 60 · **unnamed form** · 5 control(s): textarea:short_description, select:is_trial, input:${name} [checkbox], button:Back to plans, button:Save plan
  Control fragments outside literal <form> markup (1; some are interpolated into generated forms): line 59 input:${name} [${type}]

### `client/public/admin-platform-staff.js`

  - Line 86 · **unnamed form** · 4 control(s): input:name [text], input:password [password], input:confirm [password], button:Activate staff access
  - Line 102 · **sx-staff-card sx-staff-fields** · 4 control(s): input:email [email], input:password [password], button:Back to users, button:Verify and continue
  - Line 113 · **sx-staff-card** · 4 control(s): input:code [text], input:recoveryCode [text], button:Cancel, button:Verify MFA
  - Line 131 · **unnamed form** · 4 control(s): input:email [email], select:platformRole, select:reportsToIdentityId, button:Create invitation
  - Line 141 · **sx-staff-card** · 2 control(s): input:active [checkbox], button:Save staff access
  Control fragments outside literal <form> markup (2; some are interpolated into generated forms): line 123 input:data-saved [checkbox]; line 128 input:permissions [checkbox]

  Runtime field builders: line 127 form/control helper creates textarea.

### `client/public/admin-signin-mfa.js`

  - No literal form template; controls are created at runtime.

  Runtime field builders: line 51 form/control helper creates input; line 63 form/control helper creates form; line 63 form/control helper creates input; line 63 field name code.

### `client/public/admin-telephony.js`

  - Line 47 · **unnamed form** · 6 control(s): input:ariBaseUrl [url], input:ariUsername [text], input:ariPassword [password], input:enabled [checkbox], button:Save Asterisk settings, button:Test ARI connection
  - Line 74 · **unnamed form** · 7 control(s): input:name [text], input:host [text], input:port [number], output:Transport, input:enabled [checkbox], button:Save business gateway, button:Provision Asterisk peer
  Control fragments outside literal <form> markup (5; some are interpolated into generated forms): line 77 input:data-did [tel]; line 77 select:data-queue; line 77 input:data-enabled [checkbox]; line 77 input:data-inbound [checkbox]; line 77 input:data-outbound [checkbox]

### `client/public/admin-user-plans.js`

  - Line 43 · **unnamed form** · 5 control(s): input:businessName [text], output:Business category, input:${role} [number], button:Back, button:Review setup
  - Line 58 · **unnamed form** · 5 control(s): select:version, input:${role} [number], button:Back to user plan, button:Reload account, button:Review business assignment
  - Line 120 · **unnamed form** · 4 control(s): select:planId, button:Back to users, button:Reload account, button:Review assignment
  Control fragments outside literal <form> markup (2; some are interpolated into generated forms): line 91 select:Business category; line 257 select:Assign to Admin

### `client/public/agent-transfer-controls.js`

  - No literal form template; controls are created at runtime.

  Runtime field builders: line 23 form/control helper creates form; line 26 form/control helper creates select.

### `client/public/call-center/call-center.js`

  - No literal form template; controls are created at runtime.

  Runtime field builders: line 32 form/control helper creates input; line 70 form/control helper creates input; line 71 form/control helper creates select; line 72 form/control helper creates input; line 73 form/control helper creates input; line 75 form/control helper creates input; line 158 form/control helper creates input.

### `client/public/call-center/index.html`

  - Line 32 · **outgoingForm** · 3 control(s): input:destination [tel], select:callClientType, button:Call

### `client/public/chatbot-admin.js`

  - Line 616 · **unnamed form** · 5 control(s): input:name [text], select:aiFallback, input:aiDataProcessingConfirmed [checkbox], button:Cancel, button:Save bot
  Control fragments outside literal <form> markup (25; some are interpolated into generated forms): line 129 select:data-origin; line 129 input:data-search [text]; line 427 input:assignment-channel [checkbox]; line 459 select:${esc(tr('Choose automation mode','اختر وضع الأتمتة'))}; line 561 textarea:guidedContent:${esc(field.path)}:en; line 561 textarea:guidedContent:${esc(field.path)}:ar; line 562 input:guidedContent:${esc(field.path)} [checkbox]; line 563 input:guidedContent:${esc(field.path)} [number]; line 569 input:data-rule-enabled [checkbox]; line 569 textarea:data-rule-keywords; line 569 select:data-rule-match; line 569 textarea:data-rule-en; line 569 textarea:data-rule-ar; line 604 select:flowId; line 607 input:sx-test-number-entry [tel]; line 607 input:testRecipientPhone [hidden]; line 608 textarea:instructions; line 610 select:provider; line 610 select:model; line 610 input:apiKey [password]; line 610 select:dailyTokenLimit; line 611 select:confidenceThreshold; line 612 textarea:sx-chatbot-preview-message; line 614 input:data-guided-message [text]; line 916 select:data-sx-chatbot-channel

### `client/public/optional-features.js`

  - No literal form template; controls are created at runtime.

  Runtime field builders: line 40 form/control helper creates form; line 41 form/control helper creates input.

### `client/public/pipeline/index.html`

  - No literal form template; controls are created at runtime.
  Control fragments outside literal <form> markup (2; some are interpolated into generated forms): line 5 input:search [text]; line 5 select:source

### `client/public/pipeline/pipeline.js`

  - Line 55 · **editLead** · 13 control(s): input:title [text], input:contactName [text], input:contactEmail [email], input:mobile [tel], select:stageKey, select:priority, select:ownerAgentId, input:nextFollowUpAt [datetime-local], select:contactOutcome, input:followUpRequired [checkbox], input:expectedValue [number], output:Source, button:save
  - Line 76 · **newLead** · 5 control(s): select:contactId, select:stageKey, select:ownerAgentId, button:cancel, button:saveLead
  - Line 90 · **settingsForm** · 10 control(s): input:enabled [checkbox], input:autoCaptureQr [checkbox], input:autoCaptureMeta [checkbox], select:qrEntryStage, select:metaEntryStage, select:interestedStage, input:interestKeywords [text], button:addAdMessage, button:cancel, button:save
  - Line 90 · **newStage** · 2 control(s): input:title [text], button:createStage
  - Line 100 · **sale-review-form** · 17 control(s): select:offerId, select:batchId, input:learnerName [text], input:payerName [text], input:payerEmail [email], input:payerPhone [tel], input:invoiceEmail [email], output:data-sale-course-price, output:data-sale-registration-fee, input:discount [number], textarea:terms, input:dueDate [date], input:installmentAmount [number], button:remove, button:addInstallment, input:confirmCurrentOfferAndPayer [checkbox], button:requestApproval
  - Line 111 · **sale-review-decision** · 3 control(s): input:reason [text], button:approveSale, button:rejectSale
  Control fragments outside literal <form> markup (15; some are interpolated into generated forms): line 55 textarea:noteText; line 69 textarea:${escape(tr('adMessagePlaceholder'))}; line 70 input:${name} [${type}]; line 71 select:qualification_'+key+'; line 73 select:qualification_${key}; line 74 input:qualification_${key} [text]; line 75 select:course-interest-choice; line 75 input:qualification_courseInterest [text]; line 90 input:unlabelled [text]; line 90 input:unlabelled [color]; line 90 select:unlabelled; line 104 input:dueDate [date]; line 104 input:installmentAmount [number]; line 108 input:dueDate [date]; line 108 input:installmentAmount [number]

### `client/public/pipeline/reports.js`

  - Line 88 · **reportFilters** · 3 control(s): select:period, input:at [date], button:apply
  - Line 113 · **report-schedule-card** · 8 control(s): input:period [hidden], input:expectedRevision [hidden], select:timezone, input:localTime [time], input:emailEnabled [checkbox], input:whatsappEnabled [checkbox], input:paused [checkbox], button:saveSchedule
  - Line 263 · **taskFilters** · 2 control(s): select:period, button:apply
  - Line 267 · **followup-reschedule** · 2 control(s): input:at [datetime-local], button:saveTask
  Control fragments outside literal <form> markup (1; some are interpolated into generated forms): line 101 input:${channel}VerificationCode [text]

  Runtime field builders: line 221 form/control helper creates textarea.

### `client/public/tasks/index.html`

  - Line 15 · **taskForm** · 10 control(s): button:Close, input:title [text], textarea:description, select:taskType, select:priority, input:dueAt [datetime-local], button:Remove linked finance record, select:leadId, button:Cancel, button:Save task
  - Line 26 · **preferencesForm** · 4 control(s): button:Close, input:whatsappOptIn [checkbox], button:Cancel, button:Save preferences
  Control fragments outside literal <form> markup (1; some are interpolated into generated forms): line 11 select:statusFilter

### `client/public/tasks/tasks.js`

  - Line 1 · **chatForm** · 2 control(s): input:body [text], button:➤
  Control fragments outside literal <form> markup (3; some are interpolated into generated forms): line 1 input:unlabelled [checkbox]; line 1 select:Participant role; line 1 select:changeStatus

### `client/public/team-invitations.js`

  - Line 156 · **sx-role-form** · 6 control(s): input:id [hidden], input:name [text], select:seatRole, input:description [text], button:unlabelled, button:unlabelled
  - Line 156 · **sx-team-form** · 6 control(s): input:email [email], select:assignment, input:temporaryPassword [password], input:displayName [text], input:mobile [tel], button:unlabelled
  - Line 339 · **sx-accept-form** · 4 control(s): input:displayName [text], input:mobile [tel], input:password [password], button:unlabelled
  Control fragments outside literal <form> markup (2; some are interpolated into generated forms): line 211 input:permission [checkbox]; line 321 input:data-nav-key [checkbox]

### `client/public/tenant-crm-appearance.js`

  - No literal form template; controls are created at runtime.
  Control fragments outside literal <form> markup (2; some are interpolated into generated forms): line 11 input:data-logo [file]; line 11 input:data-hostname [text]

### `client/public/training-courses.js`

  - Line 102 · **sx-course-create** · 13 control(s): input:studentIdPrefix [hidden], input:nameEn [text], input:nameAr [text], input:code [text], input:durationValue [number], select:durationUnit, select:deliveryMode, input:price [number], input:registrationFee [number], textarea:descriptionEn, textarea:descriptionAr, button:Save draft, button:Cancel
  - Line 156 · **sx-batch-edit** · 7 control(s): input:code [text], input:startsOn [date], input:endsOn [date], input:capacity [number], select:status, button:Save batch, button:Cancel
  - Line 156 · **sx-course-edit** · 12 control(s): input:studentIdPrefix [text], input:expectedRevision [hidden], input:nameEn [text], input:nameAr [text], input:code [text], input:durationValue [number], select:durationUnit, select:deliveryMode, textarea:descriptionEn, textarea:descriptionAr, button:Save course details, button:Publish course
  - Line 156 · **sx-course-offer** · 3 control(s): input:price [number], input:registrationFee [number], button:Add offer version
  - Line 156 · **sx-course-batch** · 5 control(s): input:code [text], input:startsOn [date], input:endsOn [date], input:capacity [number], button:Save batch
  - Line 192 · **sx-center-profile** · 10 control(s): input:revision [hidden], input:sx-profile-logo-file [file], button:Choose image, button:Remove logo, textarea:aboutEn, textarea:aboutAr, select:reportChannel, input:reportDestination [email], button:Add recipient, button:Save profile
  Control fragments outside literal <form> markup (8; some are interpolated into generated forms): line 39 input:${name}Count [number]; line 39 select:${name}Interval; line 92 input:sx-course-search [text]; line 137 input:courseFiles [file]; line 153 select:languageChoice; line 153 input:languageCustom [text]; line 191 input:${key} [${type}]; line 193 input:data-code [text]

  Runtime field builders: line 41 form/control helper creates select; line 41 field name difficultyLevel; line 41 form/control helper creates textarea.

### `client/public/training-faqs.js`

  - Line 37 · **sx-faq-form** · 7 control(s): button:Close, input:questionEn [text], textarea:answerEn, input:questionAr [text], textarea:answerAr, button:Cancel, button:Save FAQ

### `client/public/training-finance.js`

  - Line 93 · **sx-invoice-filter** · 3 control(s): input:q [text], select:status, button:Apply filters
  - Line 104 · **sx-generator-settings** · 7 control(s): input:companyName [hidden], input:crNumber [hidden], input:address [hidden], input:invoicePrefix [hidden], textarea:footer, button:Add payment plan, button:Save invoice defaults
  - Line 104 · **sx-reminder-settings-form** · 3 control(s): input:enabled [checkbox], select:data-offset-choice, button:Save reminder settings
  - Line 127 · **sx-generator-invoice** · 11 control(s): input:customerType [radio], input:customerType [radio], input:sx-generator-search [search], input:customerName [text], input:customerPhone [tel], input:customerEmail [email], textarea:customerAddress, select:courseId, select:paymentPlan, input:replacementReason [text], button:Update invoice
  - Line 153 · **sx-aging-filter** · 6 control(s): input:from [date], input:to [date], select:bucket, input:q [text], button:Apply filters, button:Clear filters
  - Line 187 · **sx-payment-form** · 6 control(s): input:amount [number], select:method, input:receivedAt [datetime-local], input:reference [text], input:note [text], button:Record payment for verification
  - Line 213 · **sx-schedule-change-form** · 5 control(s): input:dueDate [date], input:amount [number], button:Add installment date, textarea:reason, button:Submit schedule change for approval
  - Line 220 · **sx-credit-form** · 3 control(s): input:amount [number], textarea:reason, button:Request credit for accountant review
  - Line 257 · **unnamed form** · 3 control(s): textarea:reason, button:Approve reservation, button:Reject
  - Line 257 · **unnamed form** · 5 control(s): select:method, input:reference [text], input:completedAt [datetime-local], input:confirmed [checkbox], button:Record completed return
  - Line 257 · **unnamed form** · 4 control(s): select:paymentId, input:amount [number], textarea:reason, button:Request return
  - Line 272 · **unnamed form** · 3 control(s): select:decision, textarea:reason, button:Record outcome
  - Line 272 · **unnamed form** · 5 control(s): select:paymentId, input:amount [number], input:reference [text], textarea:reason, button:Record dispute
  - Line 280 · **unnamed form** · 3 control(s): select:decision, textarea:reason, button:Record outcome
  Control fragments outside literal <form> markup (10; some are interpolated into generated forms): line 125 input:data-plan-label [text]; line 125 input:data-plan-count [number]; line 125 input:data-plan-days [number]; line 131 input:unlabelled [date]; line 131 input:unlabelled [number]; line 209 input:data-verify-note [text]; line 209 input:data-reject-note [text]; line 214 input:dueDate [date]; line 214 input:amount [number]; line 216 input:data-schedule-note [text]

  Runtime field builders: line 175 form/control helper creates input; line 183 form/control helper creates input.

### `client/public/training-forms.js`

  - Line 60 · **sx-app-filter** · 4 control(s): input:search [search], input:from [date], input:to [date], button:Filter
  - Line 64 · **sx-form-editor** · 16 control(s): input:id [hidden], input:revision [hidden], input:slug [text], input:nameEn [text], input:nameAr [text], input:titleEn [text], input:titleAr [text], textarea:descriptionEn, textarea:descriptionAr, input:${key} [checkbox], input:data-required [checkbox], textarea:consentTextEn, textarea:consentTextAr, button:Save draft, button:Publish new version, button:Preview
  Control fragments outside literal <form> markup (2; some are interpolated into generated forms): line 67 input:unlabelled [checkbox]; line 67 input:Visitor enters a value [text]

### `client/public/training-public-form.js`

  - Line 154 · **enquiry-form** · 10 control(s): input:lead-search [search], input:website [text], input:data-course-search [search], input:course_ids [checkbox], input:public-nationality-search [search], select:${esc(field.key)}, select:${esc(field.key)}, input:${field.key} [${type}], input:consent [checkbox], button:Submit registration

### `client/public/training-registration-controls.js`

  - No literal form template; controls are created at runtime.
  Control fragments outside literal <form> markup (8; some are interpolated into generated forms): line 24 select:'+(index?'course_'+index+'_':'')+key+'; line 25 input:'+(index?'course_'+index+'_':'')+'enrollment_terms [text]; line 50 input:${key} [${type}]; line 51 input:data-nationality-search [search]; line 51 select:${key}; line 51 select:${key}; line 54 input:student_signature [hidden]; line 54 input:consent [checkbox]

### `client/public/training-registration.js`

  - No literal form template; controls are created at runtime.
  Control fragments outside literal <form> markup (6; some are interpolated into generated forms): line 27 input:${k} [${type}]; line 29 input:${kind}_${i}_${c[2]} [text]; line 32 select:gender; line 33 select:graduated; line 34 select:source; line 37 input:consent [checkbox]

### `client/public/training-students.js`

  - Line 37 · **sx-st-trainer-form** · 3 control(s): select:trainerChoice, input:trainerName [text], button:Save trainer
  - Line 37 · **sx-st-attendance-form** · 4 control(s): input:sessionDate [date], select:status, input:note [text], button:Save attendance
  Control fragments outside literal <form> markup (2; some are interpolated into generated forms): line 33 input:sx-st-search [search]; line 33 select:sx-st-status

### `client/workspace-src/index.html`

  - No literal form template; controls are created at runtime.
  Control fragments outside literal <form> markup (1; some are interpolated into generated forms): line 9 select:role-select

### `client/workspace-src/signin.js`

  - No literal form template; controls are created at runtime.

  Runtime field builders: line 12 field(form, key); line 20 form/control helper creates form; line 20 field(form, 'workspace'); line 21 field(form, 'email'); line 22 field(form, 'password'); line 26 form/control helper creates form; line 26 field(form, recovery?'recovery':'code').

## Review rules for dropdown conversion

- Use dropdowns or searchable selects for finite, validated catalogues already owned by the business: course, batch, payment plan, lifecycle status, role, channel, and fixed decision/outcome values.
- Keep names, phone numbers, email, addresses, references, free-form explanations and bilingual course copy editable. Offer input hints or safe saved values where useful; do not force an incomplete list.
- Use date, time, number, checkbox and radio controls for their real data types. Replace comma-delimited list entry with individual controls only when the backend accepts an explicit bounded set.
- For very long catalogues, use a searchable select backed by tenant-scoped APIs and preserve current form validation, permission checks, RTL labels and keyboard access.

## Visual evidence and limits

The supplied current-run screenshot documents the Finance invoice builder before its modal and alignment update. The source inventory is broad but does not prove the rendered appearance of every screen, role, viewport or language. The hash-bundled primary React application is intentionally excluded from source edits; shared styling can improve it, while field-by-field changes there require recoverable source or a supported build input.

The core UI bundle is tracked at `client/public/static/js/main.73648acf.js` (about 5.2 MB), but this checkout has no matching source map or React application source tree; `client/src` currently contains only the SIP call-center adapter. The bundle is minified and builds controls through generated runtime code, so it cannot be reliably audited or maintained field by field from this artifact alone. Recover the original React source/build input before claiming the entire application has received a field-by-field audit.

## Work completed in this audit increment

- Protected plan-contract drafts now show the fixed Training Center category as read-only text instead of a dropdown with one possible value; draft submissions continue to send the API-required `training_center` category. Role limits and finite feature checkboxes remain editable.
- Business gateway settings now display mandatory SIP TLS as read-only with a short explanation; the form continues sending the API-required `tls` value. The per-channel business and queue selectors, individual DID input, routing controls, and gateway address/port remain unchanged.
- Sale-review course price and registration fee now use accessible, non-editable output fields updated from the selected published offer; the review request continues to use catalog-derived minor-unit amounts. Discount, installment schedule, payer details and terms remain editable for this individual sale.
- Lead source in the Pipeline editor is shown as a labelled, styled output rather than a disabled text box; the existing source value remains read-only.
- Manage Users business setup now presents the fixed Training Center category as a labelled output instead of a disabled text input; account limits and business name remain editable.
- The enforced TLS outputs in platform Asterisk setup, business gateway settings, and plan contracts now carry explicit English/Arabic accessible labels; the inventory identifies those fields individually.
- Chatbot assignment now shows the selected bot name in a labelled preview output instead of a readonly title input; bot and connected-number selection stay unchanged.

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

## Automation & Bots — assignment and Hybrid editor, production, 12 October 2026

The WA Chatbot assignment dialog is centered over a dimmed workspace. Its origin is a connected-number select and its automation choice is a searchable list of existing bot profiles; title remains editable. The Hybrid AI page showed the active Training BOT assigned to the connected Training Center number. No assignment or bot configuration was saved during review.

The active Hybrid editor is an internally scrollable, centered dialog. Bot name and conversation setup are editable/selectable, while the bilingual greeting, menu labels, course-list copy, course-detail copy, application invitation/link introduction, fallback and staff-handoff messages remain English/Arabic textareas because they are business-authored language. Course count is a numeric control; whether to show available catalogue-backed details uses checkboxes. Confidence threshold and AI fallback use finite selects. Provider, model, API-key and daily-token settings are disabled while the bot is active. The test-number allow-list and business instructions remain editable text because numbers and local operating guidance are not fixed catalogues. Keyword replies accept custom business phrases and replies. The editor displayed nine maximum courses and sourced course details from the published catalogue. No preview request, live message or save was issued.

The current saved unpublished-information reply still mentions “published information,” which is less conversational than the editor’s business instruction to avoid referring to records. This is a wording candidate for a separate bot-tuning pass; the current review did not alter the active reply. The short fee template expands registration fees as a separate sentence when applicable and was left unchanged.

## Tasks — production access boundary, 12 October 2026

The Tasks page at `/tasks/?embed=1` displays “Your session has expired.” A fresh production check returned HTTP 401 from `/api/user/business-auth/me`, `/api/pipeline/tasks?scope=mine&status=all&page=1&limit=1`, and `/api/pipeline/tasks/participants`, so the task list and business-backed lead/participant options are unavailable. I opened a blank task dialog through its existing client handler only as a no-submit layout preview. At 390×844, it is centered within the viewport; type and priority stack into full-width rows, and the date and lead controls remain native inputs/selects. The Arabic preview shows translated labels and RTL alignment. The source uses four task types, four priorities, a tenant-scoped lead select, and a selectable team roster with an assignee/observer role select per person. Title and description correctly remain open text; WhatsApp notifications use a separate optional consent checkbox, and task status uses a five-state select. The preview had no loaded lead or people records because of the 401 responses. No sign-in link was followed, and no task or preference was saved. The deployed page now exposes localized accessible names for Status, Refresh and dialog Close. Production browser checks verified those names in English and Arabic, the 390×844 dialog bounds (356×790.5 at x=17, y=26.75), and correct LTR/RTL direction. The versioned Tasks script returned HTTP 200 and matches the active release and container. Normal authenticated task and preference acceptance still requires a fresh business sign-in.

## Inbox — production composer and bot-number control, 12 October 2026

The Inbox message composer is a free-text field with separate attachment, emoji and voice controls, which matches the open-ended reply workflow. The per-conversation bot-number control uses the connected-number catalogue as a select. Production screenshots showed the desktop header clipping both the placeholder and its redundant helper text. The placeholder is now shorter, and the helper is hidden when selectable active numbers are available; the select itself gives the needed instruction. Guidance remains visible when there are no active bot numbers or the list fails to load. Final production fit evidence is recorded in `DEPLOYMENT.md`. Routing and assignment behavior are unchanged. The chat was opened for read-only inspection; no message was composed or sent and no bot number was selected.

## Published enquiry and student registration — test tenant mobile review, 12 October 2026

The published test-tenant course enquiry and student registration forms were checked at 390×844 in English and Arabic without submitting data. Both fit within the phone viewport with no horizontal page overflow; the registration form remains RTL in Arabic, and the enquiry form switches between RTL and LTR while retaining all nine active course choices. The enquiry picker filters the full catalogue by either English or Arabic course names, even when the visible labels are Arabic. The search field has an explicit localized label and placeholder; each course checkbox is wrapped in its visible course label.

The registration form displayed its nine active courses and 251 nationality select options (250 country/territory entries plus the prompt) in both locales. Source, gender, Qatar city, graduation, course, batch, payment plan, level, class-day and class-time fields are selections; mobile and home/emergency phone fields use `tel`, email uses `email`, and date and numeric-ID values use their matching browser input types. Adding a second course creates a complete second set of course, batch, payment, level, day, time and terms fields; the two course groups and controls stayed within the mobile layout. No applicant data was entered and no form was submitted. This verifies only the published test-tenant configurations; other tenants may publish different field combinations and still require review.

Fresh browser checks on the test tenant at 390×844 confirmed one-column mobile layout, 375 px document width, no visible control overflow, all nine course choices, and a bilingual searchable 250-country catalogue (251 options including the prompt). Arabic searches for Egypt and Ethiopia each matched one country, a no-match query showed localized guidance, and clearing restored all options. The public enquiry course selector is now a compact overlay with its own scroll area: at 390×844 the form stays 463.5 px tall while the nine-choice list overlays below the trigger; at 320×640 it opens upward and stays within the viewport width. A fresh production page loaded the updated cache-busted script URL. No course was selected and no form was submitted. Separately, both previously reviewed Pro Catalyst public form URLs currently return HTTP 404 / `FORM_NOT_FOUND`; a production read-only query found no form rows for tenant `pro-catalyst-05f1f2b34f`. No form or business data was restored or changed; owner direction is needed to determine whether the links were intentionally removed or should be republished.


## Searchable nationality selection — production, 12 October 2026

The published registration form now has a bilingual search control for its 250-country/territory catalogue. Search matches both canonical English country names and the current locale label; the saved value remains the canonical English name. A selected country stays available while filtering, while the result message counts only real matches. English and Arabic production checks passed at 390×844, including a no-match query, matching country queries in both languages, selected-value retention and restoration of all 251 select entries (prompt plus catalogue). The page stayed within the phone viewport and no application was submitted. Generic enquiry forms use the same helper when their published schema includes nationality; the reviewed enquiry form has no nationality field.

## Finance Reports — mobile search layout, 12 October 2026

The receivables-aging search field now occupies a full-width row on phones, with Apply and Clear below it, so the search prompt and entered text have enough room. At a 390×844 production viewport, the input is 316.7 px wide, the action buttons sit on the next row, and the document remains 382 px wide inside the viewport. The versioned stylesheet loaded from the deployed release. The report was viewed without applying filters or changing financial data; details and release hashes are in `DEPLOYMENT.md`.

## PBX gateway forms — inbound DID entry, 12 October 2026

The tenant gateway editor’s inbound Direct Inward Dial number is a variable phone number, so it remains editable rather than becoming an incomplete dropdown. It now uses a telephone input with a phone keypad hint and telephone autofill. The Asterisk configuration suite passes 19/19. The new versioned asset and app health were verified in production; direct visual acceptance remains pending because this browser session redirects `/admin?page=pbx-telephony` to the platform sign-in page.

## Call Center outgoing-call form — entitlement failure state, 12 October 2026

The outgoing-call form previously stayed visible and enabled when telephony status returned `FEATURE_UNAVAILABLE` or another access/status error, despite the page saying the plan did not include Call Center. The error path now hides outgoing calls and extension/queue management until a successful refresh confirms access. Production review at 390×844 verified the entitlement message, hidden call form, and 375 px page width; no call was placed. Release evidence is in `DEPLOYMENT.md`.

## Installment reminder preference page — production, 12 October 2026

The public customer page offers two fixed choices: receive email reminders or do not send them. It has no open-ended fields, so dropdown conversion would add no value. The page localizes English/Arabic labels, removes the one-time token from the address bar after reading it, resolves and updates preferences without sending browser credentials or referrer data, and disables both actions while a choice is saved. A phone-width production check at 390×844 showed the unavailable-link state at 370 px wide with no horizontal overflow. The synthetic invalid-token request returned the intended unavailable message and exposed no preference controls. Pro Catalyst currently has no invoices from which to generate a valid preference link, so the opted-in/out controls cannot be safely verified against a live invoice without creating financial data.

## Training center profile — report recipient inputs — production, 12 October 2026

The scheduled-report recipient editor now labels and configures its destination field from the selected channel. Email uses the browser email keyboard, email autofill, a 254-character limit and native address validation; WhatsApp uses a telephone keypad/autofill and a 32-character limit while leaving international phone formatting flexible for server validation. Pending recipient verification now provides a numeric keypad, one-time-code autofill, a ten-digit pattern and a localized accessible label. The existing channel select, report-recipient API and profile payload are unchanged.

At 390×844, production rendered the profile at 382 CSS px with no horizontal overflow. In English and Arabic, switching Email/WhatsApp updated the field label, type, input mode, autofill and placeholder as expected; the Arabic profile direction remained RTL. The test ended with the original English/Email selection restored. No profile was saved, recipient added/removed, or verification message sent. The shared application shell also logged unrelated 401 business-auth and 409 call-center status requests; the profile UI still loaded, so authenticated profile-save acceptance remains open.

## Finance workspace and invoice popups — Arabic mobile RTL repair, production, 12 October 2026

Production review found that the app's RTL toggle changed the shared page direction while Finance pinned its own container to LTR. Removing that override exposed a second issue: the desktop RTL sidebar offset outranked the mobile rule and compressed the Finance screen to about 96 px. Finance now inherits the live workspace direction, and its mobile rules explicitly reset both the Finance screen and reminder-settings overlay in RTL.

After release `finance-rtl2-f90eeb2-20261012`, the authenticated Arabic/RTL view was checked at 390×844. The Finance screen spans 382 px within the viewport with no horizontal page overflow. The invoice-creation popup is centered at 362×655 px; its course select lists all nine active courses and the payment-plan select has the saved options plus manual dates. Reminder settings fit a 358 px dialog and scroll internally. Both popups were closed without saving; no invoice, setting or customer record was changed. The original English/LTR interface was restored afterward. The page also emitted unrelated 401 business-auth and 409 Call Center status requests.

## Invoice register header — mobile alignment, production, 12 October 2026

The 390 px production view showed the invoice-register title and description sharing a narrow column with New invoice, Settings and Refresh. The actions are now placed below the title and description on phones; New invoice fills the row, with Settings and Refresh aligned below it. The desktop toolbar is unchanged. At 390×844, the document width is 382 px, the action group is 317 px wide, and the three controls fit without overflow. At 1440×900, the heading and all actions remain aligned in one row. No invoice, payment or finance setting was submitted.

## Phonebook — mobile grid readability, production, 12 October 2026

The Phonebook grid previously squeezed ten columns into the phone viewport, making column headings unreadable. The mobile-only styling now gives the name, phonebook, mobile-number, variable and date columns widths suited to their labels and keeps the 1,140 px table inside the grid's horizontal scroller. The document itself remains within the viewport. After reloading the authenticated production page at 390×844, the versioned deployed stylesheet was active; the scroller was 365 px wide with 1,140 px of scrollable content and all column headings were readable. At 1440×900 the desktop grid remained 883 px wide without horizontal page overflow. The live Phonebook has no contacts, so actual populated-row behavior remains unverified. No contact was added or changed. Finance layout and reminder suites pass 11/11; release, rollback and served-asset details are in `DEPLOYMENT.md`.

The inline Phonebooks editor was also reviewed in the authenticated production workspace. Its only editable value is the phonebook name, which is defined by the business and should remain free text; the Add Phonebook action is clearly named. At 390×844 the phonebook list opens in a contained 260 px drawer and the contact grid stays within the 390 px document. Arabic labels, RTL direction and the drawer were checked without creating a phonebook; English/LTR was restored afterward. There are no contacts or phonebooks in this tenant, so contact-row and edit-form behavior still need live data for acceptance.

## Students directory — mobile search and status filters, production, 12 October 2026

At 390×844, the student search, six-state enrollment select, Search and Clear controls stack at full width and remain within the 348 px content card. The four enrollment counters form a two-column grid. Arabic at the same size localizes the filters and empty state, mirrors the layout for RTL, and keeps all controls within the 382 px page; English/LTR was restored after review. No student records exist, so profile, attendance and payment popups remain unreviewed against live records. No search that changes data or record action was submitted.

The same mobile review found the Students screen's fixed layer sat above the navigation drawer, allowing the drawer to open but blocking its menu items. Its stacking level is now below the drawer. After deployment and reload, opening the drawer and selecting Courses navigated successfully at 390 px. The student screen stays above the app content and below the drawer.

## Courses — catalogue and Add course popup, production, 12 October 2026

The mobile catalogue shows all 15 courses as readable single-column cards, with search and management actions inside the 356 px page. The Add course popup fills the 390×844 viewport, scrolls its long sections internally, keeps Close and Save draft/Cancel actions available, and stays within the document width. The modal retains catalogue-backed delivery mode, course level and payment frequency selects; course names, bilingual descriptions, learning outcomes and prerequisites remain editable content. Number and duration fields use their matching numeric controls, while brochure, image and video uploads stay optional typed files. The blank draft was closed without saving.

## WhatsApp campaigns and Meta templates — production, 12 October 2026

The Send Campaign page at 390×844 renders its template search and status filter within the page, but the current tenant receives “Please check your Meta API keys”; no templates are available, so the later recipient/message configuration steps cannot be reviewed. No provider key was entered and no campaign was sent. The adjacent Create Meta Template wizard fits the same phone viewport. Its template type, language and category are fixed choices; template name, message body, optional footer, variable names and sample values are intentionally authored per campaign. Adding a variable inserts the named placeholder into the message and lists it as detected. These are valid free-text fields, so replacing them with finite selects would constrain real template content. The variable modal and wizard were dismissed without submission. The wizard is rendered by the compiled React bundle; maintainable source/build inputs for these controls are not present in this checkout, so field-level code changes remain gated on source recovery.

The connected-number page’s Manual Setup view is a 342 px wide, vertically aligned form at 390×844. WhatsApp Business Account ID, Business Phone Number ID and App ID remain text entries because they are provider-issued identifiers; Save and Fetch remain distinct actions. The Meta Access Token was rendered as plain text; a maintained page-scoped hook now masks that field in both English and Arabic and disables autocomplete/spellcheck, without changing its submitted value or the identifier controls. English/LTR, Arabic/RTL and 390 px no-overflow production checks passed. No provider credentials were entered or saved.

## WhatsApp device connections — production, 12 October 2026

The correct “Add WhatsApp by QR” route is `?page=wa-qr-connect`; the similarly named `?page=whatsapp-qr` route opens the dashboard. The device page at 390×844 fits within the 366 px content card and reports “No devices yet.” It has no visible data-entry controls or device rows, only How to? and Add Device actions. The two DOM inputs are off-canvas navigation search controls; no select or textarea belongs to this page. I did not activate Add Device because that action can create a new linked-device session/QR. The connection form can be reviewed after a safe existing test device is available or when the owner authorizes creating one.

## Automation Flows builder navigation and responsive bot panel — production, 12 October 2026

At 390×844, the four mode tabs covered the flow title and Save, New, Import, Flows and Node Menu controls. Mobile now uses a labeled native mode select and reserves a dedicated row above the React Flow canvas; the native canvas toolbar moves below that row. The desktop segmented tabs remain unchanged. On production, the selector occupies a 366×53 px strip, the canvas begins at y=124, and Node Menu opens its node picker from the visible toolbar. No flow was changed or saved.

The Hybrid AI panel previously retained its mobile width after resizing to desktop. Its bounds now update on viewport changes without reloading its data. The panel measured 1,376 px at 1440×900, returned to 390 px at 390×844, and the document stayed within 390 px. Arabic/RTL mode and labels were also checked at 390×844 with no horizontal overflow; English/LTR was restored after review.

## Finance defaults, business invoice identity and collection labels — production, 12 October 2026

At 390×844, the Finance Settings dialog contains invoice footer and saved payment-plan defaults plus installment reminders; it does not show the old “Invoice policy and approval” submission, tax treatment, or special invoice-approval form. It links center identity to the Training Center Profile. That profile has Commercial registration (CR) number, Invoice number prefix, and English/Arabic address fields. The profile was inspected without saving.

The live invoice register currently has no issued invoices. Its empty state directs staff to create invoices from approved sales, and the attention queue calls issued balances “Invoices awaiting collection.” This separates sales that still need an invoice from issued invoices with payment due. `?page=finance` falls back to the dashboard; `?page=finance-settings` is the live invoice register route. No financial record or settings were changed during review.

## Training Center Profile — full field and responsive layout audit, production, 12 October 2026

The profile has 19 visible form controls: business identity/URL/contact/address/CR/prefix/opening-hours/social/description fields use matching text, URL, email, telephone and textarea types; the scheduled-report channel is a finite Email/WhatsApp select, with a typed recipient value. Those content and contact values are correctly editable rather than dropdown-backed. At 390×844 the screen is a single-column, internally scrollable 382 px surface; its sticky Save button remains in the viewport at both ends of the 2,669 px form. At 1440×900 the profile uses two equal columns in a 1,182 px panel. Arabic/RTL at 390 px stays within the viewport. English/LTR was restored and no profile data was saved. The logo upload/clear controls were not activated.

## Finance — Create invoice popup manual schedule, production, 12 October 2026

The customer section offers Leads & Contacts lookup first and reveals manual name, phone, email and address only when “Enter manually” is chosen. The search box is the only free-text field in the default path. Course is a select populated from the nine currently available courses, and payment plan is a select with four saved plans plus manual dates. Manual schedule rows use date and numeric amount controls, with Add/Remove actions; the edit-only replacement reason remains free text because it must explain a specific correction.

At 390×844, selecting a course and manual dates expands the form beyond the dialog height. Before the fix, Generate invoice sat below the visible dialog. A sticky footer now keeps the alert/status area and full-width action visible during scrolling, while payment date and amount inputs remain reachable above it. The production dialog stayed within the viewport, including Arabic RTL; at 1440×900 it remained centered and the action was visible. The single existing generated invoice remained in history. The modal was closed without submitting or changing data. The production change is recorded in `DEPLOYMENT.md`; the audit screenshot is `invoice-modal-sticky-mobile-390x844.png` in the task workspace.

## Finance invoice popup — current production recheck, 12 October 2026

The screenshot supplied for this audit shows the earlier unaligned version. A fresh authenticated production check at 390×844 found the current modal centered at x=10, y=74.7 with size 362×694.6 px; its two 18 px customer-choice radios are styled as aligned option cards, the course and payment sections are separated, and manual customer controls have `display:none` while Leads & Contacts is selected. All nine active course options and four saved payment plans were present. At 1440×900, the modal remains centered and constrained (895×743 px); the manual-entry choice reveals name and phone fields in a two-column row, with email aligned below and address spanning the form. No invoice was generated; the popup was closed and the viewport restored to 390×844.

## Hybrid bot configuration editor — production, 12 October 2026

The long Hybrid AI create/edit dialog now scrolls its form fields inside the dialog and keeps Cancel/Save actions pinned within the viewport. The fix is scoped to this editor; the legacy automation canvas and number-assignment dialog keep their existing behavior. The production-generated page shell was preserved and its sidebar cache key advanced. No bot, assignment, privacy setting, business data, or customer conversation was saved or changed during verification.

On production at 390×844, the dialog measured 354×776 px with no horizontal overflow. Scrolling the inner form to its end left the 62 px footer visible at y=748–810. At 1440×900, the dialog measured 760×828 px and the footer remained visible at y=802–864. The English and Arabic interfaces were opened and canceled without saving; Arabic returned to English afterward. The bot list remains empty in this account view. No new JavaScript errors appeared; existing background requests still reported 401 `/api/user/business-auth/me` and 409 `/api/user/call-center/status`.

## Platform administration forms — field-choice and source review, 12 October 2026

The maintained Manage Plans editor uses text for plan names/descriptions, numeric controls for prices, duration and account limits, a finite Paid/Trial select, and checkboxes for independent feature flags. The protected contract editor uses the fixed training-center category select, bounded numeric role limits and a server-provided permission catalogue; publication is an explicit reviewed action rather than a free-text choice. Manage Users uses a saved-plan select and bounded seat controls. MFA correctly keeps email/password, a six-digit authenticator code, an optional recovery-code path, and an explicit saved-recovery-codes checkbox as credential/security inputs. Staff invitations use email, finite Staff/Admin role and an active-admin reporting select; permissions are a bounded checkbox list. These fields should remain typed or selectable according to their actual meaning, rather than being forced into dropdowns.

Source review found the one-time staff setup card had no viewport-height limit of its own; on short screens or enlarged text it could exceed the available height even though the overlay itself can scroll. The card now has a dynamic viewport height cap and its own contained scroll area, with a `100vh` fallback. The platform administration pages could not be opened in the current production session because `/admin?page=manage-plans` redirected to `/admin/login`; this source-level review does not claim authenticated production acceptance. MFA and platform-staff source contract tests passed. Existing editor/account data was not changed.

Production acceptance for the public setup-link surface used a synthetic, unusable fragment and did not submit the form. At 320×568 the card fit inside the viewport; at 320×480 it was constrained to 276×444 px and its 534 px content scrolled internally to the final action. Arabic copy also fit inside the same viewport without horizontal overflow. The account invitation list and platform settings remain unreviewed live because the protected Admin route requires an authenticated session.

## Hybrid bot editor — test-number chips, production, 12 October 2026

The bot editor replaces the comma-separated test-number box with a telephone entry and removable chips. Numbers are added one at a time; the editor removes common formatting, validates international country-code format, blocks duplicates, and enforces the existing ten-number limit. It keeps the same hidden field and `testRecipientPhones` array sent to the current API, whose server-side validation and number allowlist remain authoritative. Both English and Arabic labels are provided, and each remove control has a spoken label. The settings now appear directly below the bot name and before the long bilingual wording editor, so staff can reach them without scrolling through thousands of pixels of copy. The dynamic editor field is not fully represented by the static form scanner, so it is recorded here as a runtime-built control.

Production’s signed-in shell opened the Hybrid bot create editor, but `/api/user/business-auth/me` returned 401 and the bot list could not be confirmed. At 390×844, the constrained dialog measured 354×776 px; the test-number field and Add number action were visible near the top, immediately after the bot name. I added a disposable valid number, verified the chip and hidden API value, removed it, and canceled the editor without saving. This checked the layout and add/remove interaction without creating a bot or altering any configuration. An authenticated review of an existing bot and its saved number chips remains open.


## Lead Pipeline — course-interest suggestions

Add Lead now suggests every active, non-removed course belonging to the signed-in tenant in the user’s current language. The backend checks the existing `courses.read` permission and never returns another tenant’s catalogue. Suggestions load when the modal opens; if a role cannot read the catalogue or the request fails, the optional field stays usable as free text. Staff can preserve combined interests such as “Excel and bookkeeping” while selecting a single course with fewer keystrokes. Draft status, retired courses and deleted courses are excluded. The course catalogue appears as a native select populated with every active course and localized names. Choosing “More than one course or another course” reveals an optional free-text field; if the tenant catalogue is empty, unavailable or inaccessible to the role, that free-text field remains available. Both paths submit the existing 180-character course-interest string. Automated tests cover tenant scoping, permission denial, catalogue results above 100 items, localized choices and custom-input compatibility. The current release serves the new selector asset. Authenticated production course-list retrieval and English/Arabic visual acceptance remain open because no valid production pipeline bearer session or configured browser was available.

## Student profile — trainer and attendance controls

The student profile’s trainer assignment is a native select populated from distinct trainer names already saved on enrollments for the current tenant, with an explicit unassigned choice and an “Add another trainer” path for genuinely new names. Existing assignments remain selectable even if no longer present in the current tenant list. The existing trainer update API and stored string value are unchanged. Attendance dates use the Qatar-local calendar date, avoiding a UTC date mismatch during the first three hours of the Qatar day. The trainer and attendance forms use aligned desktop columns, collapse cleanly on smaller screens, and explicitly hide the custom-name input until selected. Focused tests cover tenant scoping, choices, custom entry, date behavior and responsive rules. Authenticated production profile interaction and English/Arabic visual review remain open because the current production session has no valid business-auth token or naturally available student profile; no student record was created or changed for testing.

## Automation → Hybrid AI bot list — mobile width and row actions

A read-only production browser inspection at 390×844 showed that the Hybrid bot list kept an 850px minimum table width. The list clipped Status and Actions and exposed a horizontal scrollbar inside the card. The mobile layout now stacks each bot row into compact cards, adds localized field labels for Bot Name, Type, Status and Actions, makes the action group use the full card width, and retains the full desktop table. Dark-theme card and divider colors are included. After deployment, production was reloaded at 390×844: the list now measures about 325px inside the 390px viewport, the document and body widths are both 390px, the table uses the card layout with no horizontal overflow, and the empty state fits the card. The current browser session is unauthenticated, so real bot rows and assignment actions remain unverified. No bot configuration or assignment was changed. No bot configuration or assignment was changed.

## Hybrid bot editor — compact empty tester list on mobile

The 390×844 production create dialog keeps the lengthy bilingual wording editor and AI controls inside its own vertical scroll region while the Cancel/Save footer remains visible. The empty tester-chip list used to show a blank bordered row before the phone input; it is now hidden only while empty and reappears naturally when tester chips are present. The fresh mobile browser check measured the document at exactly 390px wide, the empty list at `display:none`/0px, and the scroll area at 4248px content within 609px. I canceled the unsaved dialog. The available business session still returns 401 for private APIs, so saved bot fields and authenticated edit mode remain unverified.
