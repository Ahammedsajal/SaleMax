# SaleMaX mobile screen audit

## Scope and method

Production review on 13 October 2026 at mobile-width browser viewports. Screens were reviewed for visible layout, control alignment, and clipping. No customer records, messages, settings, or campaign actions were changed. The Inbox conversation pane was not opened because doing so can mark a conversation as read.

This is a continuing screen inventory, not a claim that every role-specific or Arabic screen has passed. Screens were reviewed in English at about 430 CSS pixels, with Lead Reports also checked in Arabic/RTL. Narrower widths and the remaining administrative sections still need review. During the second pass, the admin session expired and navigation redirected to `/user/login`; the business session also expired before the Phonebook could be re-opened. No credential or OTP was entered.

## Screens reviewed

| Screen | Mobile observation | Status |
| --- | --- | --- |
| Business Dashboard | At 320px, the page and cards stay within the 312px layout viewport; summary cards and chart sections stack vertically, Refresh and both date-range controls remain reachable, and the page has no horizontal overflow. Header actions and dashboard filter chips have 44px targets; the header wraps only on extra-narrow screens. | Fixed and production-verified at 220px, 240px, 280px, 300px, 320px, 390px, and 430px LTR; RTL at 320px |
| Mobile app header | The SaleMaX mark uses its existing asset at its 3:1 ratio. The shared header/drawer rules were restored to the running container after detecting an older CSS copy was being served. At 220px, header controls wrap into two rows and remain inside the viewport; at 320px all five header targets are 44px and fit. At 220px the drawer fills the viewport with 24 visible controls, each at least 44px. | Fixed and production-reverified at 220px and 320px LTR; 220px drawer verified |
| Mobile navigation drawer | Drawer fills the 220–430px viewport in LTR and at 320px RTL. Search, close, and visible navigation controls remain inside the viewport at 44px or taller. | Fixed and production-verified at 220px, 240px, 280px, 320px, and 430px LTR plus 320px RTL |
| Shared mobile density | Existing MUI screens share a phone-width type scale (24px down to 13px for headings/body variants), tighter card padding, and 44px minimum tab height. Inputs, buttons, and clickable filters retain touch-friendly sizing. Dashboard, Inbox, Training Center Profile, Meta Template, Candidate Applications, Finance, and Team Invitations were checked across narrow phone widths and RTL. | Production-verified on those routes; broader inventory and restricted-role pages remain open |
| Inbox | Search, filter, and chat actions are aligned within the phone width. English layout was previously production-verified at 220–430px and RTL at 320px. A fresh Arabic 220px review found the three toolbar icons (select chats, more options, new chat) and filter button at 28×28px because the existing mobile selector only matched the English new-chat label. The compact22 stylesheet now includes both English and Arabic selectors for 44×44px mobile actions. | Prior English/RTL layout production-verified; post-deployment compact22 check at 220px with Arabic labels and LTR direction confirmed a 212px document and 44×44px toolbar buttons; no conversation opened or read state changed |
| Business Sign-In | The stray `0` above Email Address is removed. At 220px, 240px, 280px, 320px, 390px and 430px, the page stays within the viewport; its form container now shrinks on widths up to 280px. At 220px and 320px RTL it also has no overflow. Visible email/password, password visibility, theme, and primary sign-in controls remain at least 44px high. Saved browser credentials were not submitted. | Fixed and production-verified at 220px, 240px, 280px, 320px, 390px and 430px LTR, and 220px/320px RTL; no sign-in submitted |
| Business Sign-Up | At 280px, 320px, 360px and 430px, the sign-up form fits without page-level horizontal overflow. Email, password, full-name, mobile, theme, visibility, checkbox and submit controls have 44px heights. At 280px, the Create Account with email label remains on one line. No values were entered and no account was created. | Fixed and production-verified at 280px, 320px, 360px and 430px; no account created |
| Forgot Password Dialog | At 280px, 320px, 360px and 430px, the dialog spans the viewport without horizontal overflow. The email field and close control measure 44px; Cancel and Send Reset Link are 44px. At 280px, the actions stack with aligned full-width labels; from 320px they remain aligned in one row. No email was entered and no reset link was sent. | Fixed and production-verified at 280px, 320px, 360px and 430px |
| Courses | At 220px and 320px LTR, catalogue cards stay inside the viewport, headings remain compact (24px maximum), and all visible controls have 44px minimum targets with no horizontal overflow. At 320px, the create-course form stacks fields and keeps Save draft/Cancel reachable while scrolling; the editor stays within the screen. Arabic/RTL mirrors the header, catalogue labels, cards and controls without clipping. Forms were inspected read-only; no course was changed. | LTR geometry rechecked at 220px and 320px; create/edit forms reviewed read-only in English and Arabic/RTL |
| Agent Task | At 220px and 320px, the empty task list and Add Task form fit without page overflow; the 884px task grid scrolls inside its panel. Title/description/agent fields remain within the form, and Close/Save plus pagination controls are 44px or taller. The agent picker arrow was 28px wide and is now 44×44px. RTL at 320px mirrors the controls in bounds. | Fixed and production-verified at 220px and 320px LTR/RTL; no task created |
| Student Registrations / Enrolled Students | The page now uses compact 20px/22px phone headings, tighter cards/stats, and 44px inputs, selects, and buttons. At 220px LTR/RTL and 320px LTR/RTL there is no page-level overflow or offscreen non-table control. The wide approval queue remains in an internal horizontal scroller (674–685px content in a 157–259px viewport). No student profile was opened or changed. | Fixed and production-verified at 220px and 320px LTR/RTL; wide table uses contained horizontal scroll |
| Training Form Editor | At 320px, the editor remains within a 255px scrollable pane; field rows fit without horizontal overflow and Save draft, Publish new version, and Preview remain reachable in the sticky footer. At 220px, the screen stays 212px wide; all 17 visible controls meet 44px in LTR and temporary RTL layout, with no offscreen controls. At 320px, all 19 visible controls meet 44px and remain in bounds. | Pass at 220px LTR/RTL and 320px LTR; editor opened read-only and no changes saved |
| Staff Capture Registration Form | Form fields stack to one column; the signature canvas stays inside the form column. Add/remove-course, language, signature, submit, and field controls now have minimum touch heights of 44px (50px for Submit); phone spacing stays compact. | Controls production-verified at 220px, 240px, 280px, 320px, 360px, 390px and 430px LTR, plus 220px/320px RTL with no horizontal overflow; no registration submitted |
| Public Student Registration Form | At a 320px CSS viewport, the public form has no horizontal page overflow. Its language toggle and Add another course/Clear signature actions are each 44px tall; Submit is 50px. The compact title and field typography remain within the viewport. The form was not submitted. | Fixed and production-verified at 320px; no registration submitted |
| Public Student Registration Form — SaleMaX Training Test | At 220px, 240px and 280px the center logo is constrained to 56px; at 320px and wider it remains capped at 110px. All 30 visible fields and action controls are at least 44px high (50px for Submit), and remain inside the viewport. The off-screen spam honeypot is fixed-positioned on phones so RTL does not create a 10,305px document scroll width. LTR was checked at 220px, 240px, 280px, 320px, 360px, 390px and 430px; RTL at 220px and 320px. Long form scrolls vertically; no values were entered and no registration was submitted. | Controls and LTR/RTL layout fixed and production-verified at 220px through 430px; no registration submitted |
| Candidate Applications | The list filters and form actions fit; application details scroll within the dialog and long response tables use internal scrollers. Filter chips are now 44px high. The page has no overflow and controls stay inside the viewport at 220px, 280px, 320px and 430px LTR plus 320px RTL. | Fixed and production-verified; application records were not opened or changed |
| Lead Pipeline | The embedded workspace stays within the viewport and the wide board scrolls internally. At 220px the toolbar previously expanded 27px past its 175px content area. Mobile CSS now stacks search/source/refresh and places the four view buttons in a two-by-two grid with 44px targets. At 220px LTR/RTL, 320px LTR/RTL, and 430px LTR, the page and embedded document have no horizontal overflow; all seven toolbar controls are in bounds. | Fixed and production-verified at 220px LTR/RTL, 320px LTR/RTL, and 430px LTR; board columns require internal horizontal scroll |
| Lead Reports | The embedded report filters stack inside the phone panel; period/date fields and Run Report are 44px full-width controls. The hero actions and four view tabs also stay in bounds. At 220px and 320px the embedded document remains 205px/305px wide with no horizontal overflow; at 320×480px RTL each filter control scrolls into view. Report data and schedules remain unverified; no report was run or schedule changed. | Layout and control sizing production-verified at 220px/320px LTR and 320px RTL; data/schedule state remains open |
| Phonebook | At 220px and 320px, the 1140px contact grid scrolls inside its panel (179px/287px), while the page stays within its viewport. All 20 visible controls remain in bounds; DataGrid sort/menu buttons are 44×44px at both widths. The 320px RTL layout also has no offscreen controls or page overflow. | Production-verified at 220px and 320px LTR/RTL; no contact opened or changed |
| Invoices & Payments | Finance filters, clickable chips, app header actions, and invoice actions are at least 44px. At 220px and 320px, the page has no horizontal overflow; the 666px invoice grid scrolls inside a 141–241px panel. The invoice builder was inspected at 220px RTL; its 16 editable controls/actions fit horizontally and the 1,918px form scrolls inside the 780px dialog. The dialog was closed without saving. | Shared CSS restored and Finance controls production-verified at 220px LTR/RTL and 320px LTR |
| Training Center Profile | Mobile grids and cards stay compact; phone headings are 21px, labels 12px, body/input text 13px, and input/select/action targets are 44px. The logo uploader is constrained to its card even at extra-narrow RTL widths. Rechecked at 220px LTR/RTL and 320px LTR/RTL with no horizontal overflow, controls outside the viewport, or targets below 44px. No profile or logo data was changed. | Fixed and production-verified |
| Finance Reports | At 320px, `/user?page=finance-settings&section=reports` still renders the invoice register; no distinct report layout is exposed. | Invoice register reviewed; standalone report layout remains unavailable through this route |
| Tasks | The list, create/detail dialogs, and notification preferences fit the phone viewport without horizontal overflow. Notification preferences buttons now measure 44px at 220px and 320px LTR; the dialog is 204px/304px wide, and footer actions stack at 220px. LTR was checked at 220px and 320px; RTL at 320px. No task form was saved, preference changed, or chat message sent. | Compact list, create, detail, and preferences production-verified; no task or preference data changed |
| Team Access | At 220px, the page had no document overflow, but the fixed Team Access panel internally expanded to 254px and permission/navigation checkbox rows were 38–40px tall. A compact mobile override wraps long role labels, constrains the panel to its viewport, reduces card/outer padding, and keeps all checkbox rows at 44px. Production browser checks at 220px and 320px LTR plus 320px RTL kept panel/document widths within the viewport and all 49 checkbox labels at least 44px. No roles or invitations were changed. | Fixed and production-verified at 220px and 320px LTR/RTL |
| Agent Login / Team Login | The custom Team Login overlay stays within 212px/312px at 220px/320px, and its visible search/refresh/card controls are 44px tall with no page overflow in RTL. The underlying Add Agent button is covered by the custom overlay and could not be opened through the normal UI, so its form is not verified on this route. | Overlay production-verified at 220px/320px; Add Agent form inaccessible here; no agent created or account changed |
| WA Chatbot | The chatbot profile card and Add/Assign actions fit at 220px and 320px. The Add Chatbot dialog uses a compact viewport-bounded layout, 44px fields/actions, and an in-flow mobile bot list so it does not cover Cancel/Save. At 220px LTR/RTL and 320px LTR, controls stay in bounds; at 320×480px the dialog remains scrollable and the footer is visible. No bot or profile was changed. | Fixed and production-verified at 220px, 320px, and short-height mobile view |
| FAQs | The page uses a 22px phone heading, 12px card spacing, and a compact empty state. At 220px and 320px LTR/RTL there is no horizontal overflow or clipped action. Add FAQ was opened read-only at 220px; all seven visible editor controls, including text fields and footer buttons, are at least 44px and remain inside the dialog. The dialog was closed without saving. | Fixed and production-verified at 220px and 320px LTR/RTL; no FAQ created or edited |
| Automation Flows | At 320px, the title and all five toolbar actions previously clipped and had 27px targets. The toolbar now wraps into two aligned rows with 44px buttons; the canvas begins below it, stays within the viewport, and keeps its zoom controls available. At 390px and wider the toolbar fits on one row; all five buttons remain 44px through 570px. Opened read-only; no flow was saved. | Fixed and production-verified at 320px, 360px, 390px, 430px and 570px; no page-level overflow |
| Campaign Dashboard | The overview cards stack without page overflow. At widths through 380px, paired icon tabs now use equal columns rather than clipping the second tab inside a horizontal scroller. Both overview/list tabs fit at 220px and 320px in LTR and RTL, and keep their original row sizing at 430px. Search, Export CSV, and Refresh are full-width 44px actions in the empty All Campaigns state. | Fixed and production-verified at 220px and 320px LTR/RTL plus 430px LTR; no search or export run |
| Add WhatsApp by QR | The device list and actions stay inside the page at 220px and 320px in LTR and RTL. All nine visible controls are at least 44px; the page width matches the viewport. No device or QR session was started. | Fixed and production-verified at 220px and 320px LTR/RTL |
| Link Meta WhatsApp | At 320px, Embed Login and Manual Setup, plus Save and Fetch, have 44px targets; all four setup fields fit within 272px. Embed Login remained on Loading… during review. No credential values were read, saved, or fetched. | Layout fixed and production-verified at 320px; provider state unverified |
| Web Notifications | The switch row wraps inside its card at 220px; its visible switch is 58×44px and the row stays inside the 171px card. At 320px the row stays within its 271px card. All six visible controls are at least 44px and in bounds in LTR and RTL at 320px. The browser permission is unset and the disabled setting was not changed. | Production CSS verified at 220px and 320px; permission flow remains intentionally untouched |
| Send Campaign | The authenticated menu opens `/user?page=send-campaign`; the prior `/user?page=campaigns` route opens Dashboard. At 220px and 320px, all six visible controls are at least 44px and in bounds in LTR and RTL, with no page overflow. No campaign was sent. | Production-verified at 220px and 320px LTR/RTL; route corrected |
| Create Meta Template | Wizard typography stays compact (14px/15px/12px in the current step). Visible text/select fields are 44px tall; all six steps remain vertically scrollable. Rechecked the first step at 220px, 280px, 320px and 430px LTR plus 320px RTL with no page overflow and all visible fields/buttons at least 44px. No wizard data was saved. | Compact and production-verified; all six steps were previously reviewed at 320px |
| Admin Manage Plans | Plan cards stack and Edit/Delete actions span the card width. | Pass at reviewed viewport |
| Admin Sign-In | At 220px, 240px, 280px, 320px, 390px and 430px, the card and visible controls fit within the viewport; controls remain at least 44px high. The 320px RTL pass also has no page overflow or controls outside the viewport. A decorative positioned element extends beyond the viewport but does not widen the document or overlap controls. Saved browser fields were not submitted. | Fixed and production-verified at 220px, 240px, 280px, 320px, 390px and 430px LTR plus 320px RTL; no sign-in submitted |
| Admin Forgot Password dialog | Opened and inspected without entering an address or submitting. At 220px, 240px, 280px, 320px, 390px and 430px, the dialog stays within the viewport, its visible controls remain at least 44px, and the page has no horizontal overflow. | Pass at 220px, 240px, 280px, 320px, 390px and 430px; reset request not submitted |
| Admin Add Plan | Fields stack vertically; Back and Save remain side by side at the bottom. | Pass at reviewed viewport; form closed without saving |
| Admin Manage Users | The data grid keeps its wide columns in an internal horizontal scroller; the scrollbar is visible and actions remain reachable. | Usable at reviewed viewport; horizontal table scroll required |
| Admin Add User | Modal stays inside the viewport and its footer buttons remain reachable after scrolling the form. | Pass at reviewed viewport; form closed without creating an account |
| Agent List / Add Agent | Agent grid has an internal horizontal scroller; the add form fields stack vertically. | Pass at reviewed viewport; form closed without saving |
| Admin Orders | Header and Refresh fit; search, filters, export and row actions remain reachable. | Usable at reviewed viewport; wide table scroll required |
| Admin Partner Logos | Upload area spans the available content width and remains readable. | Pass at reviewed viewport; no upload performed |
| Admin FAQ | Question and Answer fields stack; existing FAQ content is readable while scrolling. | Pass at reviewed viewport; no content changed |
| Admin Manage Pages | Legal-document actions stack at full width; title/editor/image fields remain within the page. | Pass at reviewed viewport; no page created |
| Admin Testimonials | Add form fields stack vertically; existing testimonial cards remain readable. | Pass at reviewed viewport; no content changed |
| Admin Contact Leads | Filters/export and row actions are present; long email/mobile columns extend beyond the viewport. | Usable at reviewed viewport; horizontal table scroll required |
| Admin WhatsApp Links | Filters/export are reachable; wide log columns extend beyond the viewport. | Usable at reviewed viewport; horizontal table scroll required |
| Admin Payment Gateways | Gateway controls stack as full-width cards and Save Settings is visible. | Pass at reviewed viewport; toggles and settings were not changed |
| Admin Flow Builder Templates | Template details and copy/view/delete controls fit within a single card. | Pass at reviewed viewport; no template action taken |
| Admin Theme Manager | Theme cards stack; Edit and Set Active controls span the card width. | Pass at reviewed viewport; no theme changed |
| Admin Site Settings | Branding, homepage, currency, SEO and tutorial fields stack within the page; Save Changes remains at the top. | Pass at reviewed viewport; settings unchanged |
| Admin SMTP | Configuration fields stack; Save and Test Email remain visible at the top. | Pass at reviewed viewport; no test email sent |
| Admin Web Translation | Language entries render as cards with Edit/Delete actions; the Add New Language action fits. | Pass at reviewed viewport; no language changed |
| Admin App Update | Current/latest version cards and Update Now stack vertically; changelog continues below. | Pass at reviewed viewport; update not triggered |
| Admin QR Plugin Settings | Storage choices render as cards; restart warning and Save action are visible. | Pass at reviewed viewport; storage option unchanged |
| Admin WA Embed Login | Settings fields stack; the long webhook URL wraps within its card. | Pass at reviewed viewport; credentials/settings unchanged |
| Business navigation drawer | At 320px, the drawer previously showed only a 64px icon rail inside a 260px panel, hiding labels and leaving most of the panel blank. It now uses the full drawer width with visible labels and the SaleMaX mark; the list scrolls above its pinned footer. At 430px it remains inside the page width. In RTL at 320px the drawer mirrors to the right without horizontal overflow. | Fixed and production-verified at 320px and 430px, LTR and RTL |
| Standalone Call Center | At 220px the body’s 320px minimum widened the screen, and the outgoing call form controls extended 27px past the viewport. The narrow-phone layout now removes the minimum width, stacks the heading and Refresh action, contains the outgoing form, and keeps visible buttons/fields at least 44px high. At 220px the page width equals the 205px layout width; at 320px in Arabic/RTL and 430px in English all visible controls stay within the page. | Fixed and production-verified at 220px LTR, 320px RTL and 430px LTR; no call was placed and no configuration was changed |
| Sales Workspace shell | At 220px the 320px body minimum widened the page; mobile CSS now removes that minimum, stacks the header, gives phone controls 44px targets, and lays out its five navigation tabs in two columns. The 220px/320px tab grid was measured against the production HTML after revealing the role-hidden nav controls for layout inspection: every tab fits inside the nav with no page overflow. At 220px and 320px the actual account view shows the role-gated “Section unavailable” panel; at 430px the panel and header also fit. | Shell fixed and production-verified at 220px, 320px (including RTL shell), and 430px; sales overview, deals, targets, reports and commissions remain unverified because the current account lacks access |
| Public installment reminder preferences | Action buttons stack full-width with a 48px minimum height at phone widths. Release/container/served hashes match; valid reminder-link visual review remains open. | Fixed and production asset-verified; visual review pending |
| Customer document and installment reminder public pages | Invalid/unavailable-link states were reviewed at 220px in LTR and RTL. Main content, heading, and status text remain inside the 220px viewport with no horizontal overflow. Valid document tables and reminder preference actions require an unexpired customer token; no token was available, so those data-bearing states were not opened or changed. | Error states pass at 220px LTR/RTL; valid-link content and actions remain unverified |

## Remaining inventory

The Codex in-app browser tab is at `/admin/login`, while the Playwright audit context retains the authenticated business account and can open business routes. Continue non-destructive review in that context, preserving populated forms and customer records. Platform-admin and permission-gated pages require their respective authorized account before those screens can be accepted.

Business screens still to review:

- Student profiles/attendance/payment details (no enrolled profile was available), form creation flow and application print output, plus Finance sub-screens beyond the invoice register.
- Customer document tables and reminder preference actions need valid customer links for complete audit; public Student Registration staff capture was rechecked at 220px and 320px in English and Arabic/RTL.
- Call Center, Commission Policy, Organization, Sales Overview, Sales Targets, Sales Deals, Commissions, Sales Finance, and all role-specific states. On the current account, `?page=call-center` and `?page=commission-policy` resolve to Dashboard, `?page=sales-organization` displays Dashboard content instead of Organization, and a fresh authenticated in-app visit to `?page=sales-targets` also rendered Dashboard content. Call Center is absent from the navigation drawer. These target screens remain unverified until an account/access state can render them.
- Sales Overview navigation and the direct Sales Targets route resolve to Dashboard for the current business account, so sales-only screens need an account with the required role/access before mobile review.
- Inbox conversation pane and actions remain unverified because opening a conversation can change its read state; the list-only view has now been checked at 220px and 320px.

Admin screens still to review:

- Social Login, Flow Builder Template create/detail states, Theme Settings edit/create states, full Site Settings and SMTP form scrolling, Payment Gateway expanded states, and all remaining settings.
- QR/Meta credential setup, Web Notification and Manual Web Push (currently marked PRO add-on required), Telegram Config (PRO add-on required), and platform-staff/Asterisk screens.

Repeat critical screens at narrower phone widths and in Arabic/RTL. The Finance Reports menu currently lands on the invoice register at `section=reports`; its separate report layout was therefore unavailable for this mobile review. The shared embedded-workspace fix also covers Call Center, commission, sales finance, organization and task frames; only Lead Pipeline/Reports and Tasks were visually reviewed. The sign-in implementation is present only in the compiled app bundle in this checkout; there is no source map or maintained source file available to fix the stray `0` without recovering source first.

## Automation Flows phone controls — source update, 14 October 2026

The authenticated Arabic Automation Flows screen fits at 220, 280, 320 and 390px, but its legacy toolbar actions measured 27×27px and React Flow zoom controls measured 26×27px. The mobile layout hook only recognized the English “Node Menu” aria label, so it did not mark the toolbar in the active Arabic UI. Source commit `4f46498` now recognizes the Arabic label, preserves the existing compact wrapped toolbar layout, and raises canvas zoom controls to 44×44px. An in-browser CSS preview confirms the five toolbar actions wrap within the viewport and the canvas starts below them at all four widths, with no page-level horizontal overflow. The source is pushed to draft PR #137. No flow was edited or saved.

### Live deployment recheck

On 14 October, the production Automation Flows page was rechecked at 220px, 320px and 390px. The document remained within its viewport (212px content at 220px; 320px and 390px document widths matched their viewport), but production still served old editor controls: the four visible canvas zoom buttons were 26×27px, and the Arabic toolbar hook was absent. At 220px the React Flow viewport scales the selected node to 0.308; its MUI autocomplete “Open” popup icon consequently renders at 9×9px inside the canvas. This is a node zoom limitation rather than a page-level offscreen action. No flow, profile, or customer data was changed. This earlier state was superseded by the authenticated production follow-up below; the `salemax-prod` identity observation predates discovery of the protected `salemax-production` SSH configuration.

## Meta Template larger-phone density check — production, 14 October 2026

The already-open authenticated Meta Template page was reviewed at 570px (the width in the supplied mobile screenshot) without reading or changing populated field values. The compact phone stylesheet is active: the page heading is 16px, supporting copy 12px, step label 12px, and visible navigation actions are at least 44px high. The three template-type cards stack within the page, and no visible controls extend beyond the content edge. A separate 320px screenshot shows the same compact card stack and 44px Back/Next actions. No template was submitted or saved.

## Candidate Applications list mobile check — production, 14 October 2026

The authenticated Candidate Applications list was checked at 220, 320 and 390px after the page finished loading. Its fixed screen and internal content widths remain within the available page width; all visible buttons and links are at least 44px high and in bounds. At 220px, the two date filters are 67×44px. No application was opened, and submission data was not changed.

## Candidate Applications form editor touch sizing — source update, 14 October 2026

The new course-enquiry editor was opened in the authenticated screen only after confirming its create action builds the form locally and persists only on submit. Its five text inputs measured 42px at 320px. Source commit `43ba768` sets mobile text inputs to 44px and preserves textarea height; a live-page CSS preview verifies all five inputs at 44px, four textareas at 78px, and Back/Save/Preview actions at 44px at 220, 320 and 390px. The editor stays within the page width, and no action was submitted. Production deployment and post-deployment verification are pending.

## Courses screen current-release mobile check — production, 14 October 2026

The authenticated Courses screen was checked at 220, 320, 390 and 570px. Its 38 visible controls remain within the screen, all buttons/links are at least 44px high, and neither the screen nor its contents extend beyond the available page width. The page title scales to 20px at 220px. No course detail was opened or edited.

## Finance Reports route mobile recheck — production, 14 October 2026

The authenticated `/user?page=finance-settings&section=reports` route was checked at 220, 320 and 390px. Its visible controls stay within the page except for row actions contained in the horizontal table scroller; no action is shorter than 44px. The 660px-wide invoice table remains inside its 141px, 241px and 311px scroller at those viewport widths, respectively. Current source inspection confirms the Reports route still renders the invoice register; the separate receivables report renderer is not mounted, so that report screen is not available for a mobile audit. No invoice was opened and no financial record was changed.

## Training Center Profile stale-script regression — 14 October 2026

A fresh audit at a 220px viewport found that the authenticated production page was still serving the earlier `training-courses.js` under cache key `20261014-profile-controls-compact3`, despite later deployment records describing the 44px field and narrow logo-upload fix. The served version measured ordinary inputs at 40px, the native report-channel selector at 17px, and the logo dropzone at 211px wide with its right edge 26px beyond the viewport. The page itself remained 212px wide. No profile fields or logo were edited.

The maintained source now sets phone input/select height to exactly 44px, applies `min-height:44px!important` for native-control consistency, constrains the nested logo-upload grid/label/dropzone to 100% width, and uses app script key `20261014-profile-controls-compact4`. The running container had an older script than the active release under the same key; protected copies were saved before reconciling the release and container assets. Production now serves the updated script with matching release/container hash `5ef356538eefbab64f9fa599474fabcc0ef21d1e02f578895b7072a965ec28e3`; the release/container index files retain their pre-existing baseline differences and both use the new key. The active release/container location, rollback hashes, and health checks are recorded in `DEPLOYMENT.md`.

At 220px and 320px in LTR and Arabic RTL, all 23 visible profile controls are at least 44px tall and inside the viewport; the 21px heading and logo upload dropzone also remain within the 212px/312px layout width. The public profile and logo were not changed or saved. `/healthz` returned 200, the app container is healthy with zero restarts, and the served JavaScript hash matches the deployed files. The host has only 632MB free at 99% disk use, so further release work needs space monitoring.

## Shared header and drawer release drift — 14 October 2026

A fresh 320px check found the live container had reverted to smaller header controls: hamburger 36×40px, language 48×15px, RTL 36×36px, and theme 30×30px. The active release had the tracked `20261014-mobile-all-screens2` stylesheet and the shared 44px rules, while the running container index used `all-screens1` and served an older stylesheet. Backed up both copies, synchronized the active-release CSS into the container, and updated only the container cache reference. Release, container, and served stylesheet hashes now match. At 220px, 280px, 320px and 430px LTR, all five header targets are 44×44px and remain within the screen; at 320px RTL the header also fits. The RTL drawer at 220px fills the viewport, scrolls internally, and has no undersized or horizontally off-screen controls. No account data changed. See `DEPLOYMENT.md` for the rollback hashes and current release evidence.

## Mainline mobile compact pass and release drift — 14 October 2026

The prior screen-by-screen observations above remain a dated record, not a current all-screen acceptance claim. This follow-up moves shared phone density and the known profile, students, registration, FAQ, Tasks, Lead Pipeline, Sales Workspace, Call Center, Candidate Applications, customer-document, and reminder layouts onto a branch based on the latest `origin/main`.

A compact mobile stylesheet is loaded after the existing brand stylesheet. It restores the original WhatsApp mark in the header and keeps it compact; it does not substitute the SaleMaX wordmark for that icon. Fields and actions retain touch-friendly targets while headings, cards, and spacing contract at phone widths. Standalone workspaces and public forms receive their own stylesheet updates and cache keys.

At the latest production check, the active release was `/opt/salemax/releases/candidate-applications-actions-final-f3e1edf-20261014`. Its brand CSS hash was `fcae567cf2ad525e46265ab42c0eb595fcb07ef5d93bf8e1f9eb948d20b661c2`, while the running container served older CSS hash `4b56c557a9edd1b1f5ecf8d17b20b85ec7845b43fd3bb473ae03aebe00b75373`; the index hashes matched. The production browser session is currently at `/admin/login`, so authenticated screen acceptance is open until the business account is signed in again. No records or form actions were changed during this pass.
## Production mobile compact rollout — 14 October 2026

The shared compact stylesheet and targeted page rules from source commit `de7efdfff509cdfe2fd8b0fbad901b3ab63ff4b7` are active in release `candidate-app-details-consent-35c0c00-20261014` and its existing app container. `/healthz` and the shared mobile stylesheet return HTTP 200; the app container is healthy with zero restarts. At 390px and 320px, the authenticated Students route has zero horizontal overflow, and its five visible actions and two visible fields measure 44px high. The public landing screen also has zero horizontal overflow at 390px. No customer records or forms were changed.

This remains an initial responsive spot check, not completion of the full screen-by-screen audit. Other authenticated routes, nested detail and dialog states, narrower widths, and Arabic/RTL behavior remain open. See `DEPLOYMENT.md` for the current release hashes and rollback archives.
## Additional screen-by-screen mobile spot checks — 14 October 2026

At 320px, the authenticated Training Profile has zero overflow; its 25 visible controls are at least 44px high, and the logo dropzone ends at x=277 within the 312px content viewport. Students has zero overflow at 390px and 320px; five visible actions and two fields measure 44px at both widths. Create Meta Template has zero overflow at 320px; six visible buttons and the visible MUI form controls are at least 44px (two 19px native inputs are visually hidden MUI select internals). Tasks has zero overflow at 390px and 320px, with eight visible buttons and one field at least 44px. Call Center has zero overflow at 320px, with four buttons and two fields at least 44px. Lead Pipeline was corrected after finding 38–42px actions and 39px search/filter controls; after stylesheet version 2, its seven visible buttons and two fields measure 44px at 320px with no overflow.

The public staff registration form at 390px has no horizontal overflow and its four visible buttons are at least 44px; its single shorter control is a checkbox. The open form had two populated fields, so it was left intact and not reloaded or edited. Customer document and reminder pages were checked only in their no-token invalid-link states; valid customer-link layouts remain unverified. Inbox/conversation screens were left unopened to avoid changing message read state. Call Center and Sales Workspace page shells fit the checked viewport, while full authorized content acceptance remains open. These checks do not complete the full screen inventory; detail/dialog states, narrower widths, and RTL remain outstanding.

## FAQ dialog and dashboard follow-up — 14 October 2026

The shared stylesheet's version 3 fixes the FAQ primary buttons that measured 42px on the injected screen. At 320px the FAQ page has zero horizontal overflow and both visible actions are 44px. Its unsaved dialog is 276px wide within the 312px content area; visible controls are 44px or 108px and its three actions are 44px. The dialog was closed without saving. Finance, Dashboard and Candidate Applications Forms also had zero horizontal overflow at 320px; visible buttons measured at least 44px. The Dashboard header uses the existing WhatsApp icon in a 34×48px slot, with adjacent title and 44×44px controls positioned without overlap. `/healthz` remained 200 and the app container stayed healthy without restart. The active release, hashes and rollback archive for stylesheet version 3 are recorded in `DEPLOYMENT.md`.

## Students title cascade correction — 14 October 2026

A fresh 220px RTL Students check showed the page title remained 28px even though the shared mobile rule specified 20px. The page's later-loaded screen stylesheet won the cascade. The mobile title declarations now use `!important` at 600px (22px) and at 300px (20px); the shared stylesheet URL is versioned as `20261014-mobile-compact4`. After the production asset update and reload, the title measured 20px at 220px and 22px at 320px. Both widths had zero horizontal overflow; seven visible buttons at 220px and the nine visible buttons/fields/selects at 320px were all at least 44px tall. No student record was opened or changed.

## Dashboard and Profile compactness recheck — 14 October 2026

At 220px and 320px, Dashboard and Training Profile each fit within the viewport with no horizontal overflow. Dashboard section headings render at 20px and all visible controls stay within the viewport at 44px or taller. Training Profile's main heading is 21px; its visible inputs, select and buttons are 44px or taller, with no off-screen controls. Finance at 220px LTR also fits at 212px document width, with compact 18–20px section headings and 44px minimum visible form/action targets; the wide invoice grid continues to use its internal scroller. No records or form values were changed.

## Training drawer and QR device controls — 14 October 2026

A 320px interaction check found that the mobile navigation drawer was visually present but covered by the fixed Training Profile layer (z-index 1201 over drawer z-index 1200); the screen's hidden layer intercepted nav taps. After the phone-only stacking correction, all 18 visible drawer rows on Training Profile and Students receive pointer hits in the drawer at 320px; Students also passes at 220px, and Profile-to-QR navigation succeeds. The QR device screen had 22px copy, 30px delete, and 42px help icon targets. Shared mobile CSS now makes all its small icon buttons 44×44px and fits the device header without page overflow at 220px and 320px. At 320px, all nine visible controls are at least 44px high. Two off-screen student row actions at 220px are contained by the 141px internal table scroller. No student or device action was taken. Production CSS version 6, active release hashes, and rollback copies are in `DEPLOYMENT.md`.

## Meta API Manual Setup fields — 14 October 2026

The authenticated Manual Setup screen had four 36px text fields and a 26px-wide clipboard icon at 320px. The shared phone stylesheet now gives standard MUI text fields 44px minimum height and expands this page's clipboard action to 44×44px. At both 220px and 320px, all four fields and visible actions measure at least 44px high, the clipboard action is 44×44px, and the document has no horizontal overflow. Production CSS version 8 is live; release and container hashes match and `/healthz` plus the cache-busted stylesheet return HTTP 200. Existing Meta setup values were not read, edited, copied, saved, or fetched.

## Tasks and Meta Template narrow-phone review — 14 October 2026

The authenticated Tasks page was inspected in Arabic/RTL at 220px and 320px without opening a task or using a page action. The document width matched the viewport, all visible controls stayed inside it, and visible buttons/selects were at least 44px high. The already-open Meta Template form was inspected without refreshing or changing its populated values. At 320px its content fit the 312px page width; at 220px all controls remained inside the 212px page width and the form cards/fields stacked compactly. Inspection found the shared fixed header wraps to 99px at 220px/260px while its content spacer remained 56px, placing page content behind the header. A shared phone rule now matches that spacer to 99px through 260px. The live production CSS version 9 was rechecked at 220px: header and spacer both measure 99px, content begins below them, document width is 212px, and no visible controls are offscreen. At 320px document width is 312px with no offscreen controls. No task or template data was changed.

## Public staff registration form extra-narrow heading — 14 October 2026

The existing staff-capture form was inspected at 220px and 320px without reading or editing any field values. At 220px, the organization heading and logo shared a narrow row and the heading occupied 236px vertically. The phone layout now stacks the heading and logo, reduces the title to 16px, and aligns the logo to the edge; the heading block is 108px tall. Visible controls remain within the page, with no horizontal overflow, and fields/selects remain 44px tall. At 320px, the existing single-row heading is unchanged, all visible controls remain in bounds, and document width is 305px. Production stylesheet cache key is `20261014-mobile-compact2`; release/container hashes and health checks are recorded in `DEPLOYMENT.md`. No form values were changed or submitted.

## Dashboard refresh target recheck — 14 October 2026

At 220px and 320px, the Dashboard remains inside its page width with no offscreen controls; section headings render at 20px and visible actions are 44px high. The localized Dashboard refresh icon measured 40×44px, so shared phone CSS now gives it a 44×44px target. The 220px live recheck confirms the new version-10 stylesheet, 212px document width, 44×44px refresh action, and no offscreen buttons. No dashboard data or actions were changed.

## Courses screen header fit — 14 October 2026

At 220px, the Courses screen used a fixed top offset of 56px under a wrapped 99px app header, and its heading rendered at 24px. Shared phone CSS now moves the Courses layer to 99px and reduces its title to 20px at widths up to 260px. Live production verification at 220px shows a 212px document width, no offscreen controls, and the layer starts below the app header. At 320px the page is 312px wide, the 24px title remains readable, and controls stay within the viewport. No course data or actions were changed.

## Training Profile and Students fixed-screen header fit — 14 October 2026

At 220px, the Profile screen began at 56px while the app header wrapped to 99px, covering its heading and top content. The Students layer began at 58px, covering its table header and first rows. Shared phone CSS now moves both fixed screens below the 99px header at widths up to 260px. Live version-12 checks show Profile starts at 99px with its heading at 114px and no offscreen controls; Students starts at 99px with no page overflow. Two Students row actions remain within the existing horizontal table scroller. At 320px, these screens keep their existing offset and fit within the 312px document width. No profile values or student rows were changed.

## Team Invitations phone layout — 14 October 2026

At 220px, the Team screen started at 56px under the 99px wrapped header, its text fields/selects measured 42px, and buttons measured 40px. Shared phone CSS now moves the fixed layer to 99px through 260px, uses a 20px title at those widths, and sizes text fields/selects/actions to at least 44px while retaining native checkbox dimensions. Production version 13 verification at 220px shows 212px document width, title at 20px, and no horizontally offscreen controls. At 320px, the screen is 312px wide with fields and buttons 44px high and no offscreen controls. No invitation was sent and no team data was changed.

## Training Forms compact controls and date filters — 14 October 2026

At 220px, the application date filter's intrinsic width extended 29px beyond the left page edge, the back-to-workspace tile was 180px tall, and several form links/actions were 36px. Shared phone CSS now constrains date fields to their grid cells, reduces the back action to 44px, makes links/actions at least 44px, and uses a 22px page title. At 220px all controls are inside the 212px page; date inputs are 67px wide in their two-column filter cells. At 320px the page is 312px wide, the back action is 44px, and all 19 visible controls remain in bounds with no button/link shorter than 44px. No form was opened, edited, or submitted.

The production pointer advanced from the prior mobile release to a newer application release that carried stylesheet version 12, so the Team version-13 change was no longer served there. Version 14 reapplies the Team fix together with Forms adjustments on the current release. Live Team checks at 220px and 320px confirm screen top offsets clear the header at 220px, fields and buttons are at least 44px, and no controls are horizontally offscreen.

## Finance and FAQ fresh active-release recheck — 14 October 2026

On the current active release, Finance Settings was checked at 220px and 320px in Arabic/RTL. Its fixed screen fits the page width, visible controls are at least 44px high, and the 660px invoice table remains within its 141px internal scroller; no invoice was opened. FAQ at 220px/320px has no horizontal overflow, a 22px heading, and visible actions at 44px. No finance or FAQ content was changed.

## Shared phone density refinement — 14 October 2026

The shared app stylesheet now uses smaller phone typography (21px main heading, 19px section heading, 17px third-level heading, and 12–14px supporting text), tighter card/dialog spacing, and compact button labels across MUI-backed business and admin screens. Existing 44px minimum touch targets remain. The original SaleMaX/WhatsApp branding and mobile header sizing are unchanged. This is a source change only; authenticated production verification and role-specific screen coverage remain open.

## Authenticated route recheck and Campaign Board tab correction — 14 October 2026

With the authenticated business session in the browser automation tab, stylesheet version 15 was checked on Dashboard (`?page=campaigns` currently renders the Dashboard), Courses, Candidate Forms, Lead Pipeline, Finance, Finance Reports, WhatsApp QR, Campaign Send, and Training Profile. At 220–390px, the reviewed pages have no page-level horizontal overflow or visible controls outside the viewport; actionable controls remain at least 44px high. The Finance table's 660px content and its row actions remain in the contained `table-wrap` horizontal scroller. The public staff-registration form was measured at 220, 280, 320 and 390px without reading or changing populated field values; the only undersized visible control is its native consent checkbox, and its off-canvas honeypot input is intentionally hidden. No campaign was sent and no student, invoice, profile, template or staff data was changed.

Campaign Board (`?page=campaign-dashboard`) had a mobile-specific issue at 220px: its selected icon tab was 200px wide inside a 163px strip, cutting off the active tab label. Shared phone CSS version 16 caps two-tab icon groups at extra-narrow widths. Production recheck at 220, 280, 320 and 390px shows the selected tab fully visible, its sibling reachable by horizontal scrolling, no page-level overflow, no offscreen controls outside the tab scroller, and all visible actions at least 44px. At 220px the selected tab is 160×47px inside the 163px scroller. No campaign or customer action was taken. This remains a partial route audit; account-restricted screens, nested detail states and the full admin inventory remain open.
## Phonebook toolbar and additional business routes — 14 October 2026

The authenticated Phonebook initially placed its 85px Export action at x=219 on a 220px viewport, beyond the 212px app content. The shared phone CSS now wraps paired DataGrid toolbar groups below 600px. At 220, 280, 320 and 390px, the Export action stays in bounds at 44px high, there is no page overflow, and no non-scroller controls are offscreen. The 1,140px-wide table content is contained in its 179px horizontal scroller at 220px. No contact was opened or edited.

The same active version was checked on FAQ, Team access, Tasks and Lead Reports at 220–390px. Page-level widths match their mobile content widths; visible actions are at least 44px and remain inside the viewport. Team's fixed layer clears the wrapped header at 220px (top 99px). Tasks renders its Arabic RTL list with its controls in bounds. Lead Reports keeps its wide content inside internal scrolling. No FAQ, team, task, contact or report data was changed. Account-restricted and nested detail screens remain outstanding.

## Inbox Arabic narrow-phone hit areas — source fix, 14 October 2026

On the authenticated Arabic Inbox at 220px, the three header icon actions and filter control measured 28×28px. The shared Inbox mobile selectors matched only the English `Start New Chat` label, so their 44px rules did not activate in Arabic. Source now detects either language and gives Inbox actions 44px minimum width and height. At 220px and 320px, a temporary style preview showed all 13 visible controls at least 44×44px, inside the viewport, with no page-level overflow. The chat list was reviewed without opening a conversation; no read state or message changed. The source fix is pending deployment.
## Student registrations phone recheck — 14 October 2026

The authenticated Students route was checked at 220, 280, 320 and 390px on stylesheet version 17. The page fits its available width without page-level overflow; visible controls are in bounds and meet the 44px target. Three row actions remain reachable in the existing horizontal table scroller; no student row or profile was opened. No registration or customer data was changed.
## SaleMaX header wordmark fit recheck — 14 October 2026

A 320px authenticated browser screenshot showed the SaleMaX wordmark truncated to “Sal…”. Shared CSS version 18 now preserves the complete 58px wordmark and existing icon mark across widths 320–380px. At 320, 360 and 380px all five header controls are 44×44px, remain inside the viewport, and the document has no horizontal overflow. Branding assets were not changed. The ultranarrow 220px header retains its existing compact mark-only layout.

## FAQ phone and RTL recheck — 14 October 2026

The authenticated FAQ screen was rechecked read-only at 220px and 320px. In LTR at both widths, the 22px page heading, empty state and content fit the 212px/312px app column without horizontal overflow; all nine visible controls are at least 44px high and remain in bounds. At 320px RTL, the same nine controls remain in bounds and at least 44px high, with no page overflow. RTL was emulated in the page DOM for measurement only; the account language/direction preference was not changed. No FAQ was created or edited.

## Finance Create Invoice editor phone check — 14 October 2026

The blank Create Invoice editor was opened after source inspection confirmed opening it performs GETs for finance configuration/catalogue and persistence occurs only on submit. At 220px and 320px LTR, the dialog fills the available width (212px/312px) and the editor scrolls internally. Text/select fields measure 44px, the textarea remains taller, radio choice labels have 67px tap rows, and visible action buttons are at least 44px. Temporary 220px RTL emulation also kept all 18 interactive controls inside the viewport with no page overflow. The editor was closed without searching for a customer or submitting an invoice. No invoice or customer data was changed.

## CRM Appearance phone sizing — source fix, 14 October 2026

The owner-accessible CRM Appearance screen was inspected without changing its settings. In production at 320px, the title was 27px, the file/text inputs 42px, and the Save/Connect buttons 40px. Source now adds a compact phone style (21px title/16px card headings, tighter card spacing, 44px inputs and buttons) with a 19px title and full-width actions below 260px. Browser CSS preview at 220px RTL, 320px LTR and 390px LTR shows the page fits its 212px/312px/382px content width; all visible actions are at least 44px and none extend past the viewport. The settings screen itself remains at its production sizing until this source update is deployed. No logo or CRM domain settings were changed.

## Team Login mobile sizing — source fix, 14 October 2026

The authenticated Team Login page was reviewed without opening an account row or password dialog. In production at 320px, its title was 24px, the search field 42px and four visible buttons 38px; the list stays within the page and its wide table is replaced by mobile cards. Source adds a compact 21px title (19px below 260px), 12px card padding, and 44px inputs/buttons. Browser CSS preview at 320px LTR and 220px RTL keeps all five controls in bounds with no horizontal overflow and no action below 44px. The source fix is pending production deployment; no team account or password was changed.

## Tasks notification preferences mobile sizing — source fix, 14 October 2026

The authenticated Arabic/RTL preferences dialog was opened at 320px without changing the checkbox or saving. Production showed a 286px dialog, while Cancel and Save measured only 35px and 37px tall. Source now gives the dialog compact phone padding and scroll bounds, wraps its preference text, keeps the checkbox comfortably targetable, and makes its actions 44px; at 220px the footer stacks. Browser CSS preview at 320px produced a 304px dialog with 44px actions; at 220px it produced a 204px dialog with 44px full-width stacked actions. Both widths had no horizontal overflow. The source update is pending deployment; notification preferences were not changed.

## Business Sign-In narrow RTL recheck — production, 14 October 2026

The existing sign-in screen was rechecked at 220px in LTR and RTL and at 320px in LTR. It stays within the 220px/320px viewport, all five visible controls remain at least 44px high, and no control extends past the viewport. The locale was temporarily emulated in the page DOM for RTL measurement and restored. No saved credentials were submitted.

## WA Chatbot compact cards and dialog — production follow-up, 14 October 2026

At 220px, a native chatbot profile card forced its inline flex row to 247px inside a 171px panel; the Assign action extended beyond the viewport. Source now constrains the card and grid and stacks profile metadata/actions. The Add Chatbot dialog also had 38px fields and an automatically opened bot list that overlapped Cancel/Save at narrow widths. The compact mobile style gives its fields/actions 44px targets, bounds the dialog to the viewport, and places the bot list in the dialog's scroll flow. Production checks at 220px LTR/RTL, 320px LTR, and 320×480px show no horizontal overflow or offscreen controls; the visible bot option does not overlap the footer. No bot, profile, assignment, or setting was saved.

## Team Invitations permission touch rows — production follow-up, 14 October 2026

The owner-accessible Team Access screen was inspected without reading member values or changing invitations. Production checks at 220px and 320px show all 49 permission/navigation checkbox labels at least 44px, the panel has no internal horizontal overflow, and the page stays within its viewport in LTR and RTL. No invitation or role setting changed.

## Send Campaign route and narrow-phone review — production, 14 October 2026

The authenticated navigation item opens `/user?page=send-campaign`; `/user?page=campaigns` opens Dashboard. At 220px and 320px, six user-visible controls remain at least 44px and in bounds in LTR and RTL, and the document width matches the viewport. The visually hidden MUI select input was excluded from touch-target sizing. No campaign was sent and no settings were changed.

## Web Notifications switch row — production follow-up, 14 October 2026

At 220px, the notification row and switch fit inside the card; the visual switch is 58×44px and no page-level overflow occurs. At 320px the row fits in its card, all six visible controls are in bounds and at least 44px in LTR and RTL. Shared stylesheet compact25 was loaded for the authenticated measurement. The browser permission and disabled toggle were left untouched.

## Task notification preferences — production follow-up, 14 October 2026

The preferences dialog was opened read-only after confirming it loads current preferences with GET and saves only on form submit. Production Tasks CSS compact2 now constrains the dialog to the viewport and makes Cancel/Save 44px high. At 320px LTR the dialog is 304×274px; at 220px it is 204×344px with full-width stacked footer actions. No horizontal overflow or offscreen controls occur. The preference checkbox was not changed and Save was not pressed.

## Shared mobile compact stylesheet rollout — production follow-up, 14 October 2026

Source commit `f408e755ded2887119eaeca8c9d2fd8e711ea285` (draft PR #137 branch) is now active in `/opt/salemax/releases/qr-share-nav-e943ba3-20261014` and the existing `salemax-app-1` container. The production-generated index was preserved; only its single cache reference changed from `20261014-mobile-compact18` to `20261014-mobile-compact22`. The deployed shared CSS SHA-256 is `4491336d9ecd6a65a10412e6ab933c7fbc83b1800fc724fe3e098e619cb610b1`; release, container and public HTTPS hashes match. The production-generated index SHA-256 is `c82125ec5e5bed8a38572cfa6cb44b36345286ed9a098631a9ee5d125975a4a4`; release, container and public HTTPS hashes match. `/healthz` and the cache-busted CSS return HTTP 200. The app remains healthy with restart count zero; no database migration, business record, customer data or form action changed.

The source rules compact phone typography and card spacing while preserving 44px control targets, restore the existing WhatsApp header mark, fix Inbox Arabic action selectors, and correct the notification, DataGrid and Flow canvas controls. Protected rollback files and a gzip-tested database backup are in `/opt/salemax/shared/backups/mobile-compact22-20261014-f408e75` (mode 0700; files mode 0600). Database archive SHA-256 is `c98df22d64ea5380216ef8dab53efca3fd72c4e89a8dc356187311563687076b`. To roll back the CSS-only deployment, restore `release-css.before` and `release-index.before` to the active release's `client/public`, then restore `container-css.before` and `container-index.before` to `/app/client/public` in `salemax-app-1`; no pointer change, restart, or database recovery is required. The database archive is retained for disaster recovery, not needed for this CSS rollback.

At the initial CSS deployment the available Codex in-app browser tab showed `/admin/login`; the separate Playwright audit context still had authenticated business routes, so post-deployment review continued there.

## Authenticated production mobile follow-up — 14 October 2026

The Arabic Automation Flows editor was reloaded after deploying the responsive script and loader assets. At 220px, its five toolbar actions and four canvas controls measure 44×44px; the 188px toolbar wraps into four rows inside the 212px page. At 320px, the 296px toolbar wraps into two rows; at 390px, all five toolbar actions fit in one row. Every visible control remains in bounds and page width equals the viewport content width at 220, 320 and 390px. No flow was edited or saved.

The Training Profile was rechecked at 220px and 320px: 33 visible controls, no non-checkbox target below 44px, no offscreen controls, and document widths of 212px/312px. Arabic Inbox list at 220px and 320px has 13 visible controls, all at least 44px and in bounds, with document widths of 212px/320px. No conversation was opened and read state was not changed.

Create Meta Template was rechecked at 220px and 320px: the page fits (212px/313px), its six visible buttons are 44px high, and its text/combobox controls are 44px; two 19px native inputs are hidden MUI select internals. WA Meta Manual Setup at 220px and 320px has 13 visible controls (9 buttons and 4 fields), all 44px high and in bounds. Configuration field values were not read or changed; no Meta setup action was submitted.

The open staff registration form was measured without reading any field values or changing the populated form. At 220px and 320px, its 30 user controls are all at least 44px high and in bounds; the page widths are 205px/305px. The offscreen, nonfocusable `.honeypot` input is excluded from user controls. The signature canvas remains within the form column (134×180px at 220px; 234×180px at 320px). No registration was submitted.

The authenticated browser audit context is now available. Remaining inventory still includes role-gated sales/admin pages, nested detail/create/edit states, public customer-link states, broader RTL/narrow-width repeats, and the Inbox conversation pane. Read-only list/form geometry checks do not establish those unvisited flows.


## CRM Appearance and standalone Lead Pipeline — compact phone follow-up, 14 October 2026
Source commit e3feb6eed317c14daa36b85aa5e6b272f9ea1f45 is on branch mobile-responsive-mainline-20261014. It updates the maintained CRM Appearance and Pipeline source, preserving the existing generated production index behavior.


CRM Appearance now loads /tenant-crm-appearance.js?v=20261014-mobile-compact2. At 320px its title is 21px and visible logo/domain inputs and actions are 44px tall; at 220px both actions fill the 135px form column. Page widths are 312px and 212px with no horizontal overflow. Logo and domain settings were not changed.

The standalone /pipeline/ screen now loads pipeline.css?v=20261014-mobile-compact4. Its Arabic hero had compressed the primary actions to 71px wide and 73–92px tall at 220px; the two actions now stack at 177×44px. At 320px both are 277×44px. Page widths are 217px and 305px with no page overflow. Pipeline stages and summary keep their existing contained horizontal scrolling. The CSS update retained active production rules for embedded pipeline views and added compact rules for the standalone screen.

The production-generated user index hash is 06f1425e1d85fa3b4db0a3f95abdcb7d70c027da54f0156cf48fb1bd14cf37f9; CRM Appearance JS hash is f2df782a8cc8d725312a5a55f2e0cee2bf91a9f50e3d10fff725a6d0193b12ac. Standalone pipeline index and CSS hashes are 0706a5d3168e7f9d261ea733518a8023b454100b4badfee9ec56ad72f5988834 and 21c7d7376332f78f3d38f71e8316c19c548c8a9a4173f934de55100b86e7b2f0. Release copies are protected under /opt/salemax/shared/backups/mobile-compact22-20261014-f408e75; Appearance has release and container before-images, and Pipeline retains release before-images. The active release pointer did not move. The app container remained healthy with restart count 0. No settings, leads, customer records, or forms were changed.

This is a continuing audit. Screens still need route-by-route review, including deeper edit/detail/dialog states, customer-link states, restricted admin and sales routes, and broader phone-width and RTL coverage.

## Campaign Board extra-narrow filter sizing — production follow-up, 14 October 2026

Source commit ce9fa9a52897b5c9096f4b6d8a4598eb2b551c5e updates the shared phone stylesheet. At widths up to 260px, fixed-width MUI fields now shrink to their parent card; visible MUI selects keep a 44px touch target at phone widths. The existing campaign tab strip remains horizontally swipeable.

On the authenticated Campaign Board All Campaigns tab, the 220px layout previously had a 200px search/select inside a 163px form and the page was 225px wide. After the fix, search and filter controls are 163×44px, the visible combobox is 130×44px, and document/body/main widths are 212px with no page overflow. At 320px, fields are 271×44px and the visible select is 238×44px; document width is 320px. No campaign was created, edited, exported, or sent.

The shared stylesheet cache key is 20261014-mobile-compact24. At deployment, the current release pointer resolved to /opt/salemax/releases/pipeline-manager-shared-31baae8-20261014 and the existing app container 7ef86c16f51e67bd3a1e2cd3c0ea9f69f8c8700537215601ddab44a0ec3ed775 remained healthy with zero restarts. User index SHA-256 is 8dbb6fdbedb65529031344dd74f93f0afa0d13a4457016ab2d9726a43f5c0ba5; shared mobile stylesheet SHA-256 is a990b6ecf21ae898c3a6d7de349160548e0d39738e75f49d3935b4e9889aa11f. Release and container hashes match. Protected pre-change release/container files are in /opt/salemax/shared/backups/mobile-compact22-20261014-f408e75 as release-index.mobile-compact23-before-campaign-select-fix, release-salemax-mobile.compact23-before-campaign-select-fix, container-index.mobile-compact23-before-campaign-select-fix, and container-salemax-mobile.compact23-before-campaign-select-fix. The active pointer was not changed by this update.

The full route inventory remains open, including restricted admin/sales screens, nested create/edit/detail states, valid customer links, and additional RTL and device-width checks.

## Team Access compact phone follow-up — 14 October 2026

Source commit `48e3e781568a6361c25545d61211de2f4e121574` updates only the shared mobile stylesheet and its cache key for the existing Team Access screen. It wraps long labels, removes internal horizontal overflow, tightens card and edge spacing, and makes all permission/navigation checkbox rows at least 44px tall.

Authenticated post-deployment checks at 220px and 320px show document widths of 212px and 312px respectively, matching the viewport minus the browser scrollbar; the Team Access panel has no internal horizontal overflow. All 49 visible permission/navigation labels are at least 44px. LTR and RTL were checked at 320px. No roles, invitations, or access settings were changed.

The active release at final verification is `/opt/salemax/releases/inbox-shared-qr-access-a880679-20261014`. A later container recreation had restored compact22 copies; the active release already held compact25. The running container was synced to the active release's main index and stylesheet, then browser and public hash checks were repeated. Final container `6364466be16f67f1aa2813c5f4bbe380b47cad06b24186db578fc38677d55452` stayed healthy with restart count 0. Shared stylesheet SHA-256 is `54dd3e7ba69b1741f94e545b55bdefcea64100d2e5c303ecac74ff56c4147a9d`; generated user index SHA-256 is `e31ed3a99736407f58841e77ec8978a85c1eac6ce5e2b8ad3d98e9bc9d052cd4`; release, container, and public HTTPS copies match. Before-images are retained in `/opt/salemax/shared/backups/mobile-compact22-20261014-f408e75`, including `release-salemax-mobile.compact25-before-team-access`, `release-index.compact25-before-team-access`, `container-salemax-mobile.compact25-before-team-access`, `container-index.compact25-before-team-access`, and the later container-resync captures `container-salemax-mobile.compact25-before-container-resync` and `container-index.compact25-before-container-resync`. The production-generated index remains intact except for the stylesheet cache reference.

Task notification preferences are also production-verified using Task CSS version 2 at 220px and 320px; the dialog and actions fit, and no preference was saved. The task CSS SHA-256 is `a3598c0160beae95cf746e1938c120290b9d20328f12bb72a71fe564d1681982`, and Task index SHA-256 is `4b21554db7290e9832d467befc14c444639a9fd5e05553624937cd751c9f455c`. Release/container copies match; the task endpoints return HTTP 200. Task before-images are `release-tasks-css.compact26-before-task-prefs`, `release-tasks-index.compact26-before-task-prefs`, `container-tasks-css.compact26-before-task-prefs`, and `container-tasks-index.compact26-before-task-prefs` in the same backup directory.

## WA Chatbot dialog — production follow-up, 14 October 2026

After the initial compact-style deployment, production inspection found the bot list opens automatically and could cover footer actions at 220px. The updated shared stylesheet makes the list part of the dialog's scroll flow and advances the cache key to compact27. At 220px LTR/RTL, 320px LTR, and 320×480px, the authenticated dialog and all visible controls are in bounds, every control is at least 44px high, and the option list ends above the footer. No bot or assignment was saved. The active release is `/opt/salemax/releases/inbox-shared-qr-access-a880679-20261014`; release/container CSS SHA-256 `be64942bf7cdbe4a77ef5a8da33a84c2a40feb33f3b5f9e2cae0330f38c4a3af`; production index SHA-256 `add051a3bc3603b192d55db6b303ae6706b97f1adecd9a395f70c49d95a76f16`. Health and asset endpoints returned 200. Protected compact27 before-images are in `/opt/salemax/shared/backups/mobile-compact22-20261014-f408e75`.

## Phonebook narrow-phone post-deployment check — 14 October 2026

With shared stylesheet compact27 loaded, the authenticated Phonebook list was checked at 220px and 320px in LTR, plus 320px RTL. The document stays 212px/320px wide, all 20 visible controls are in bounds, and sort/menu buttons measure 44×44px. Its 1,140px contact grid scrolls inside the 179px/287px panel. No contact was opened, selected, or edited.

## Lead Reports filter controls — production follow-up, 14 October 2026

The authenticated `/user?page=lead-reports` route embeds `/pipeline/?embed=1&view=reports`. At 220px and 320px LTR, the embedded document stays 205px/305px wide without horizontal overflow. Its hero actions and four view tabs are 44px; period/date fields and Run Report now stack at 44px across the report panel. The filters can each be scrolled into view at 220px LTR and 320×480px RTL. No report was run and no schedule or lead was changed. Report data and schedule behavior remain unverified.

## Add WhatsApp by QR narrow-phone check — production, 14 October 2026

At 220px and 320px in LTR and RTL, the device list and actions remain in bounds with no document overflow. All nine visible controls are at least 44px high. No How-to, Add Device, QR, delete or copy action was activated.

## Agent Task form picker — production follow-up, 14 October 2026

The empty Agent Task screen was checked at 220px and 320px in LTR and RTL. The document stays 212px/312px wide; its 884px task grid scrolls within the panel. The blank Add Task form stacks its title, description and agent fields; Close and Save are at least 44px. The autocomplete dropdown arrow was 28×44px and is now 44×44px. Pagination stays within the vertical page scroll. The form was closed without saving and no task was created.
## Training Center Profile save action — production follow-up, 14 October 2026

At 320px RTL, the sticky Save action overlapped the first contact input while the profile was at its initial scroll position. The mobile rule now makes the action static so it follows the entire form instead of covering fields. Verified on production at 320px RTL and 220px RTL: document widths are 312px and 212px, there are no controls outside the viewport, the Save action is 44px high at the end of the form, and every visible button is at least 44px. The profile, logo, report recipient settings, and account data were not changed.
## Dashboard narrow-width and Call Center route availability — production, 14 October 2026

The authenticated Dashboard was checked at 220px and 320px in LTR. The document/main widths are 212px and 312px, with no page-level horizontal overflow or visible buttons outside the viewport; all visible buttons are at least 44px high. Direct navigation to `/user?page=call-center` returned to the Dashboard in this account, so the Call Center screen remains unavailable for this account's audit. No dashboard action was triggered and no call was placed.
## CRM Appearance production RTL follow-up — 14 October 2026

The live `/user?page=crm-appearance` screen was rechecked at 220px RTL and 320px LTR/RTL. Its four visible upload/domain inputs and action buttons are 44px high, stay inside the viewport, and the document remains 212px/312px wide with no horizontal overflow. At 220px, each action fills the 135px form column. RTL was measured with a temporary direction attribute and restored; no logo or domain control was activated and no setting changed.
## CRM Appearance wrapped-header overlap — production fix, 14 October 2026

At 220px and 260px, the shared header wraps to 99px, but CRM Appearance began at 56px and its title overlapped the header's second row. The maintained script now offsets the screen to 99px below 260px. Production checks at 220px and 260px show the screen begins at the header bottom with no overlap, no page overflow, no offscreen controls, and all visible inputs/buttons at least 44px. At 280px the header is 56px and the screen remains at 56px with no overlap. No logo or domain setting was changed.
## Team Login wrapped-header overlap — production fix, 14 October 2026

At 220px the header wraps to 99px but the Team Login overlay began at 56px, causing its title to overlap the second header row. The maintained `team-login.js` now moves the overlay to 99px at widths up to 260px. Live production at 220px RTL shows the page begins at the header bottom, the title does not overlap header controls, the document is 212px wide, and all five visible controls are in bounds and at least 44px high. The team list and account/password actions were not activated.
## Course Enquiry form editor checkbox targets — production fix, 14 October 2026

The blank Course Enquiry editor was opened without saving or publishing. At 220px RTL, the two checkbox labels in each field row measured 17–20px high, leaving small, hard-to-tap targets. Mobile CSS now gives all 52 field/Required labels at least 44px height; at 220px their minimum width is 48px. Production checks at 220px RTL and 320px RTL/LTR show no page overflow, offscreen controls, or non-checkbox input/button below 44px. The editor uses its own vertical scroll and its 44px Save draft and Preview actions remain visible while scrolling. The local-only preview was later rendered from the blank editor; network review showed GET requests only. No form was saved or published.


## Candidate Applications extra-narrow card density — production, 14 October 2026

At 220px RTL, the single application row already rendered as a card, but its label/value columns left roughly 11px for values and expanded the row to 1,931px. `training-forms.css` now stacks each field label over its value at widths up to 260px. Production checks show the card row at 454px tall at 220px, 435px at 260px, and 388px at 320px; at 320px the paired label/value layout remains unchanged. At 220px LTR and RTL there is no page overflow, and the visible application action is 93×44px. The stylesheet is served as `/training-forms.css?v=20261014-mobile-compact4`; CSS SHA-256 is `72134d1558bee6923277148f415b147db77d1b78fb8875d6f6cc440613be10dc`, and production-generated index SHA-256 is `2fe4122f9d3169e2fca15afbc83bb5943689e4885647a71114cea27943aa64e9`. Release and container copies match, health/CSS endpoints returned 200, and the app container stayed running with zero restarts. Before-images are `release-training-forms.compact4-before-narrow-applications`, `release-index.training-forms-compact4-before-narrow-applications`, `container-training-forms.compact4-before-narrow-applications`, and `container-index.training-forms-compact4-before-narrow-applications` under `/opt/salemax/shared/backups/mobile-compact22-20261014-f408e75`. No application was opened or changed.


## Candidate Applications detail dialog mobile density — production, 14 October 2026

The existing application detail was opened read-only to check the nested dialog layout; applicant values were not captured or changed. At 220px and 320px, the stacked header's intro block had inherited a 320px flex basis and made the header 509px tall. The phone rule now sizes that block to its content while spanning the available dialog width. Production checks show header heights of 306px at 220px and 287px at 320px (down from 509px), with all three 48px actions in bounds, no horizontal overflow, and internal dialog scrolling. The dialog was closed without invoking Print or Edit. CSS SHA-256 is `ff110410a59c7015c20d39801b55e349af7e39104b101cb2cf56718657fddf31`; production-generated index SHA-256 is `6e2b3a5b47d26e4867365e12c810fe24fab8fed3b691a01be35fcb8d25d918a0`. The CSS is served as `/training-forms.css?v=20261014-mobile-compact5`; release and container hashes match, health/CSS endpoints returned 200, and the app container stayed running with zero restarts. Before-images are `release-training-forms.compact5-before-detail-header`, `release-index.training-forms-compact5-before-detail-header`, `container-training-forms.compact5-before-detail-header`, and `container-index.training-forms-compact5-before-detail-header` in `/opt/salemax/shared/backups/mobile-compact22-20261014-f408e75`.


## Finance Reports navigation route and mobile table — production, 14 October 2026

Following the account's Finance Reports menu item resolves to `/user?page=finance-settings&section=reports`, which renders the invoice register rather than a separate report view. At 220px and 320px RTL the page remains 212px/312px wide with no page-level horizontal overflow. The 660px invoice table scrolls within its 141px/241px panel; action columns are reachable inside that scroller and visible buttons/fields remain 44px or taller. No invoice was opened, edited, deleted, or created. A separate report layout remains unavailable on this route/account.

## Automation Flows mobile toolbar and canvas — production fix, 14 October 2026

On the authenticated `/user?page=automation-flows` screen, the flow title input measured 16px high and the mode selector 40px; on 220px phones, the 150×100px minimap also overlapped the four stacked zoom/interactivity buttons. The shared mobile stylesheet now makes the title and mode controls 44px high, moves the minimap to the canvas top-right at 96×64px below 380px, and raises the canvas controls just enough to keep them in the 800px viewport. At 220px and 320px, both LTR and RTL, the page has no horizontal overflow, the title/mode controls measure 44px, the minimap is separate from the 44px zoom controls, and no visible control is outside the viewport. The 220px page retains a 28px vertical scroll area at 800px height; its visible controls remain reachable. Embedded controls inside the zoomed flow node remain scaled with canvas zoom and require zooming in before they can be used. No flow was saved or changed, and the display direction was restored to LTR after RTL review.

Production serves `/salemax-mobile.css?v=20261014-mobile-compact33`. CSS SHA-256 is `89abfdad22e6e6f942b610715541a0095de543c1c0e0aac839a1d56a001011a0`; production-generated index SHA-256 is `368e8d106018a63334a3fe377e8ca56730280ab26b22dc8b3d5a2ea39d701524`. Release and container copies match, the CSS and health endpoints returned HTTP 200, and the app container remained healthy with zero restarts. Protected release/container before-images are in `/opt/salemax/shared/backups/mobile-flow-compact31-20261014`, `mobile-flow-compact32-20261014`, and `mobile-flow-compact33-20261014`. No customer, flow, or other business data changed.

## Fresh mobile screen checks — production, 14 October 2026

The Training Center Profile was reloaded with compact33 at 220px LTR and 320px LTR/RTL. All 33 visible controls were in bounds and at least 44px high; at 220px the header ended at y=99px and the profile heading began at y=111px. No profile or logo data was changed. The Create Meta Template first step was checked at 220px and 320px LTR/RTL: there was no page overflow, text/select and navigation controls were 44px high, and the radio option rows provided 44px targets. No template data was saved. Web Notifications was checked at 220px and 320px LTR/RTL on compact33: all six controls were in bounds and at least 44px with no page overflow; the browser permission was not requested and the setting was not changed. Meta Embedded Login stayed in its disabled loading state at 220px; its seven visible controls were in bounds and 44px or taller. Provider setup state remains unverified.

The empty FAQ state was checked on compact33 at 220px and 320px LTR/RTL: all 11 visible controls were in bounds and at least 44px, with no page overflow. No FAQ was created. Team Invitations was checked at 220px LTR and 320px LTR/RTL: all 75 visible controls were in bounds; short checkbox inputs are surrounded by 44px-or-taller labels. No invitation or permission was changed.

## Lead Pipeline toolbar overflow — production fix, 14 October 2026

At 220px the embedded `/pipeline/` document was 217px wide in a 205px layout viewport because `.toolbar` retained the source selector's 190px minimum width. The compact6 mobile rule stacks the search, source filter, and refresh action and lays out the four views in two columns. Production at 220px LTR/RTL, 320px LTR/RTL, and 430px LTR now has no outer-page or embedded-document overflow; all seven toolbar controls are 44px high and within the viewport. The existing board remains horizontally scrollable inside its own panel. No lead was opened or changed.

Production serves `/pipeline/pipeline.css?v=20261014-mobile-compact6`. CSS SHA-256 is `00ea9ecccdfd970288e3e11877bc0a095c5d3f7fd002aa99a6de4653456b2cd5`; production pipeline index SHA-256 is `ce592aecf47cbae099745d99c361be053991327dd3a57dee1a802a2007f1ba6a`. Release/container hashes match; `/healthz`, the pipeline index, and versioned CSS returned HTTP 200. The app container stayed running with zero restarts and the release pointer and database were not changed. Protected before-images are in `/opt/salemax/shared/backups/mobile-pipeline-compact6-20261014` with mode 0600.

## Campaign Dashboard paired tabs — production fix, 14 October 2026

At 320px the Campaign Dashboard overview tab measured 200px and the All Campaigns tab 127px, so the second tab was partly outside the panel; the same clipped navigation persisted at 220px. The shared phone stylesheet now lays out paired icon tabs as two equal columns through 380px. At 220px the tabs are 81×76px; at 320px they are 131×45px. Both are fully visible at 220px and 320px in LTR and RTL, and both fit at 430px in the normal horizontal layout. The All Campaigns empty state was also checked: Search, Export CSV, and Refresh are full-width 44px controls at 220px and 320px. No campaign was changed, searched, or exported.

Production serves `/salemax-mobile.css?v=20261014-mobile-compact34`. CSS SHA-256 is `0a3f5488ebf4d4fe82c45e5e0eac4274a54c57fe772a976c1c68e2c7902021e3`; production-generated index SHA-256 is `4601788bddc2b548ae0aae7454229445730e93aeeebe32975435900a32a81634`. Release and container hashes match; `/healthz` and the versioned CSS return HTTP 200. The active release stayed `/opt/salemax/releases/inbox-shared-qr-access-a880679-20261014`; `salemax-app-1` remained running with zero restarts. Protected before-images are under `/opt/salemax/shared/backups/mobile-responsive-campaign-tabs-20261014` (directory mode 700, files mode 600). No release pointer, database, or business data changed.

## Public Student Registration staff-capture recheck — production, 14 October 2026

The blank Pro Catalyst staff-capture form was rechecked at 220px and 320px in English/LTR and Arabic/RTL. The page stayed within its 205px/305px layout width. All 26 real text/select/date fields measured 44px and remained in bounds; visible language, Add another course, and Clear signature actions measured 44px, Submit measured 50px, and the agreement target fit (134×72px at 220px; 234×48px at 320px). The 134×180px signature canvas fit at 220px. The offscreen anti-spam field was excluded from user control measurements. No form value was entered, no additional course was added, and no registration was submitted.

## Phonebook selection controls — production fix, 14 October 2026

The authenticated Phonebook list was reviewed without opening a contact or changing list data. At 320px, the page has no horizontal overflow, but its select-all and per-row checkboxes measured 42×42px. The compact35 mobile stylesheet raises all visible table-selection targets to 44×44px. At 220px and 320px, the page remains within the viewport; the list's own grid remains horizontally scrollable without adding page-level overflow. On the live page, all 11 rendered selection controls measured 44×44px at both widths, and no visible button/input/select/textarea was smaller than 44px. The document remained 212px wide within the 220px layout viewport and 320px wide at 320px. The Inbox list-only view was also checked at 220px and 320px with at least 44px toolbar controls and no page-level overflow. Unread conversations were not opened, so the conversation pane and actions remain unverified.

Production serves `/salemax-mobile.css?v=20261014-mobile-compact35`. CSS SHA-256 is `a933550e10e3c2e0c05c4e8fbb2abb4d698947a35c1c09c30f86f901f97a08d9`; production-generated index SHA-256 is `25664c62ca1106bbd1905bd3b9b1bf4de8bcd69a9acc28b9200c2e8de7640142`. Release and container copies match; `/healthz` and the versioned CSS return HTTP 200. The active release stayed `/opt/salemax/releases/inbox-shared-qr-access-a880679-20261014`; `salemax-app-1` remained running with zero restarts. Protected before-images are under `/opt/salemax/shared/backups/mobile-phonebook-checkbox-20261014` (directory mode 700, files mode 600). No database, contact, conversation, or other business data changed.

## WhatsApp Bot list-only check — production, 14 October 2026

The authenticated WhatsApp Bot landing/list state was checked at 220px and 320px. Page width stays within the viewport, all six visible controls at 220px are at least 44px and in bounds, and at 320px no visible button/input/select/textarea is smaller than 44px or offscreen. An existing bot card was left unopened; no bot was created, edited, or assigned.

## Inbox conversation pane access boundary — production, 14 October 2026

The inbox list was checked at 390px in the authenticated business account. The document and body are 390px wide with no page-level horizontal overflow; the header, search, filter, selection, and new-conversation controls are at least 44px high. The All filter was restored after inspection. Read-filter rows still showed red unread-count badges, so no conversation was opened; the conversation pane and its actions remain unverified. No message or conversation state was changed.

## CRM sign-in screen — production mobile check, 14 October 2026

The `/user/login` form was checked at 220px, 320px, and 390px. Document/body widths matched the viewport at all three sizes, and visible fields and buttons were at least 44px high and in bounds. The existing prefilled form was left untouched and not submitted. This check covers the CRM user sign-in page; privileged Admin login and authenticated role-specific screens still require the corresponding authorized access.

## Create Meta Template extra-narrow layout — production, 14 October 2026

The blank Create Meta Template screen was rechecked at 220px and 320px after the compact mobile rules. At 220px the page width is 212px with no horizontal overflow; the title is 15px, supporting copy and step heading are 12px, the form cards stack, and visible actions/fields stay in bounds at 44px or taller. A temporary RTL direction check at 220px also had no overflow or offscreen visible controls; the original direction was restored. The shorter 19px MUI native select inputs are hidden internal controls. No template was created or submitted.

## Web Notification add-on state — production mobile check, 14 October 2026

The authenticated Web Notification route was checked at 220px and 320px. At both widths, page/body width stays within the viewport and all six visible buttons/fields are at least 44px high and in bounds. A temporary RTL direction check at 220px had no overflow or offscreen controls, and the original direction was restored. The route remains in its existing add-on-required state; no notification setting was changed.

## Agent Login list — production mobile check, 14 October 2026

The authenticated Agent Login list was checked at 220px and 320px. The page/body stays within the viewport and visible controls meet the 44px minimum. At 320px, the 1,015px-wide data grid scrolls horizontally inside its 295px panel, while the outer page remains 320px wide; row switches in offscreen columns were not activated. No account or agent setting was changed.

## Student Registration form editor — production mobile check, 14 October 2026

The existing Student Registration form editor was opened read-only and checked at 220px and 320px. At 220px the page/body stays within the 212px layout viewport; at 320px LTR and a temporary RTL direction the page/body stays within 312px with no offscreen visible controls. All visible non-checkbox fields/actions are at least 44px high. The 74 small checkbox inputs are paired with labels at least 44px high and 48px wide. The long editor scrolls vertically, and Save Draft/Publish/Preview actions remained 44px tall. The original direction was restored; the editor was closed by reloading the forms page without saving, publishing, or previewing.

## Admin sign-in password field — production mobile fix, 14 October 2026

At 220px the Admin sign-in password field had only 28px of usable width because the visibility toggle and card padding consumed the row. The compact rule now reduces form side padding and lets the password field use remaining space. Live production checks at 220px, 260px, and 320px measured password widths of 51px, 91px, and 127px respectively; email width was 107px at 220px. LTR and temporary RTL checks had no page overflow or offscreen controls, and visible controls remained at least 44px high. No credentials were submitted.

## Candidate Applications list and Course Enquiry editor — production, 14 October 2026

The authenticated Candidate Applications screen was checked in Arabic/RTL at 220px and 320px. The document/body measured 212px/312px, with no horizontal overflow or offscreen controls. All 26 controls on the list view were at least 44px high. The unsaved Course Enquiry editor was then opened and checked at both widths; all 73 visible controls and checkbox labels were at least 44px high and remained within the viewport. Its field list scrolls vertically within the editor. The Student Registration create action was not activated.

The submitted-application detail dialog was opened read-only. Its four actions fit within the 212px and 312px page widths, and the dialog scrolls vertically. At 220px and 320px, the linked-lead action was initially 30px high. `training-forms.css` now raises that mobile target to 44px. After the production cache key was refreshed, the action measured 44px at both widths, all four actions were in bounds and at least 44px high, and there was no page-level overflow. The dialog was closed without editing or printing; no submission data was changed.

## Finance Create Invoice dialog — production mobile check, 14 October 2026

The blank invoice builder was opened read-only and checked in Arabic/RTL at 220px, 320px, and 390px. The dialog remained within the viewport and used internal vertical scrolling; no visible controls were horizontally offscreen. The native radio inputs measured 40px high, while their labels measured 67px, providing the tap area. Other visible controls met the 44px target. The 107×44px submit button fit in bounds. The builder was closed without submitting, and the Finance page remained at 382px document width in the 390px viewport. No invoice or customer data was changed.

## Mobile navigation drawer — production, 14 October 2026

The authenticated navigation drawer was checked at 220×800px and 320×760px. Its width stays within the viewport, its long menu scrolls vertically inside the drawer, and the 24 visible interactive controls measured at least 44px high with no horizontal overflow or offscreen targets. Navigation items were inspected without changing account settings or business records.

## Tasks route session state — production, 14 October 2026

The `/user?page=tasks` route opens an embedded Tasks page that displays “Your session has expired. Sign in again, then reopen Tasks.” The CRM shell remained within the viewport at 220px and 320px, but the Tasks list and its controls could not be audited because the embedded session was expired. No task was opened or changed.

## Courses overview and list route — production mobile check, 14 October 2026

The authenticated Courses route and its overview, course-list, and learner-journey regions were checked at 220px and 320px while displayed in Arabic/RTL. The document/body measured 212px at 220px and 312px at 320px; all 47 visible interactive controls were in bounds and at least 44px high. No page-level horizontal overflow or internal horizontal scroller was present. No course or learner record was opened or changed.

## Lead Reports embedded view — production mobile check, 14 October 2026

The Lead Reports route embeds `/pipeline/?embed=1&view=reports`. At 220px, the outer page/frame measured 220px and the embedded document/body measured 205px; at 320px, the frame measured 320px and embedded document/body 305px. In both views all nine visible interactive controls were at least 44px high and within bounds, with no horizontal overflow. No report filters or records were changed.

## Send Campaign screen — production mobile check, 14 October 2026

The authenticated Send Campaign route was checked in Arabic/RTL at 220×800px and 320×760px. Document/body widths stayed within the viewport. Its seven visible interactive controls, including custom select/search controls, measured at least 44px high and remained in bounds; the 19px native MUI select input is an aria-hidden internal control paired with a 44px visible combobox. No campaign was launched or edited.

## FAQs screen — production mobile check, 14 October 2026

The authenticated FAQs route was checked in Arabic/RTL at 220×800px and 320×760px. The document/body measured 212px and 312px respectively; all 11 visible interactive controls were within the viewport and at least 44px high. No page-level horizontal overflow was present. No FAQ was created or edited.

## Agent Tasks screen — production mobile check, 14 October 2026

The Agent Tasks route was checked in Arabic/RTL at 220×800px and 320×760px. Document/body widths stayed within the viewport; all seven visible interactive controls were at least 44px high and in bounds. No horizontal overflow was present. No task was opened or created.

## Authenticated shell header — production mobile check, 14 October 2026

After the compact language-control CSS was deployed, the authenticated header was reloaded at 550px. The toolbar measured 542×56px in the 550px viewport. Hamburger, language, RTL, theme, and account controls each measured 44×44px and remained in bounds; the logo/name also fit. The language label span measured 1×1px while its accessible name remained “Lang Arabic”. The production CSS and generated index matched their release/container copies, and `/healthz`, the CSS asset, and the authenticated user page returned HTTP 200. No app restart, release-pointer change, migration, or business-data change occurred. The shell displays its existing WhatsApp mark, while the drawer uses the SaleMaX wordmark asset; this is an existing branding inconsistency, not a change from this responsive fix. Full mobile route/state coverage and Admin/Sales role access remain open.

## Campaign Dashboard overview mobile follow-up — production, 14 October 2026

The authenticated Campaign Dashboard overview was rechecked in Arabic/RTL at 390×844, 320×760, and 220×760. Document/body widths were 382/382px, 312/312px, and 212/212px respectively, with no page-level horizontal overflow. Every visible button and tab remained in bounds and at least 44px high; at 220px the paired overview/campaign tabs wrap to 81×76px, while at 320px they measure 131×45px. The overview’s empty charts and recent-campaigns state were inspected read-only; no campaign was sent, edited, searched, or exported.

## Admin sign-in screen mobile follow-up — production, 14 October 2026

The Arabic Admin sign-in screen was checked at 390×844, 320×760, and 220×760. Page width matched each viewport. The email/password controls and sign-in button remained in bounds and 44px high; the password visibility control measured 44×44px. At 220px, the editable password text area measured 51px wide beside the toggle, and the email text area measured 107px wide. The phone layout has no horizontal overflow. No sign-in, password visibility, reset, or other form action was activated.

## Sign-in mobile link tap targets — production, 14 October 2026

The Admin reset-password link and the business login recovery, account-creation, Terms, and Privacy links were rendered below 44px on the live sign-in pages. The shared mobile stylesheet expands these targets to 44px only on email/password sign-in screens up to 600px wide. After production deployment, authenticated Arabic/RTL browser checks at 220px, 320px, and 390px measured all four business login links at 44px with no page overflow; the Admin reset link and existing 44px form controls also remain in bounds at 220px. The deployed cache key is `20261014-mobile-compact40`. No login, visibility, recovery, or account-creation action was activated.

## Campaign Dashboard All Campaigns mobile recheck — production, 14 October 2026

The All Campaigns tab was inspected in Arabic/RTL at 220px, 320px, and 390px. The page stayed within each viewport with no horizontal overflow. Paired tabs measured 81×76px at 220px, 135×45px at 320px, and 200×44px / 127×44px at 390px. The search field, filters, Search, Export CSV, and Refresh stayed in bounds; the visible actions measured 44px high, and the filter control with a 24px native input sits inside a 44px field. No campaign was searched, exported, refreshed, edited, or sent.

## Training Profile full-form mobile recheck — production, 14 October 2026

The authenticated Arabic/RTL Training Profile form was measured after its layout settled at 390×844, 320×760, and 220×760. Document/body widths were 382/382px, 312/312px, and 212/212px; all 33 visible buttons, fields, role buttons, and upload controls stayed within the viewport and measured at least 44px high. The long form remains vertically scrollable. No profile field values were read or changed, and no upload or save action was activated.

## Main Dashboard mobile recheck — production, 14 October 2026

The authenticated main Dashboard (`/user?page=dashboard`) was measured in Arabic/RTL at 390×844, 320×760, and 220×760. Document/body widths were 382px, 312px, and 212px; all nine visible buttons and other interactive controls stayed in bounds and met the 44px height target. The page remains vertically scrollable. Account metrics were not copied; no dashboard action or record was changed.

## Inbox list mobile recheck — production, 14 October 2026

The authenticated Inbox list was rechecked at 390×844, 320×760, and 220×760 without opening any conversation. Document/body widths were 390/390px, 320/320px, and 212/212px; 13 visible interactive controls remained in bounds and at least 44px high at every width. No message or read state changed. The small auxiliary iframe is an existing 1px-high utility frame; its contents were not accessed.

## Student Registrations table link target — production, 14 October 2026

The authenticated Student Registrations screen was checked in Arabic/RTL at 390×844, 320×760, and 220×760. Document/body widths remained 382px, 312px, and 212px. Its approximately 592–600px-wide table is contained in a 323px, 253px, and 157px horizontal scroller respectively; three row controls are reachable through that scroller. One table link was 33px high, so a scoped mobile rule raises it to 44px. The production cache key is `20261014-mobile-compact41`; live checks measured the link at 44px at all three widths with no page overflow. No student row or action was opened.

## Finance invoice register mobile recheck — production, 14 October 2026

The authenticated Finance route (`/user?page=finance`) was checked in Arabic/RTL at 220×760, 320×760, and 390×844. Document/body widths were 212px, 312px, and 382px. All nine visible interactive controls stayed within the viewport and measured at least 44px high; there was no page-level horizontal overflow. No invoice was opened or changed, and no finance action was triggered.

## Phonebook screen current-release recheck — production, 14 October 2026

The authenticated Phonebook screen was checked at 220×760, 320×760, and 390×844. The page stayed within each viewport; all rendered controls remained in bounds and at least 44px high. The 1,140px grid remains contained in an internal horizontal scroller measuring 179px, 287px, and 357px wide respectively. No contact was opened or changed.
