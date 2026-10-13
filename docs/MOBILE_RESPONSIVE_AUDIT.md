# SaleMaX mobile screen audit

## Scope and method

Production review on 13 October 2026 at mobile-width browser viewports. Screens were reviewed for visible layout, control alignment, and clipping. No customer records, messages, settings, or campaign actions were changed. The Inbox conversation pane was not opened because doing so can mark a conversation as read.

This is a continuing screen inventory, not a claim that every role-specific or Arabic screen has passed. Screens were reviewed in English at about 430 CSS pixels, with Lead Reports also checked in Arabic/RTL. Narrower widths and the remaining administrative sections still need review. During the second pass, the admin session expired and navigation redirected to `/user/login`; the business session also expired before the Phonebook could be re-opened. No credential or OTP was entered.

## Screens reviewed

| Screen | Mobile observation | Status |
| --- | --- | --- |
| Business Dashboard | Summary cards stack cleanly; refresh and date-range controls remain visible. | Pass at reviewed viewport |
| Inbox | At 320px, the chat list fits within the viewport and scrolls internally. The toolbar's account menu extended from x=320 to x=370, clipping it completely; a scoped compact-header rule reduces the toolbar spacing and control sizes so all header controls end within x=312 at 320px and x=352 at 360px. At 430px the original spacing remains and the account menu ends at x=418. Conversation pane not opened. | Fixed and production-verified at 320px, 360px, and 430px |
| Business Sign-In | Form fields and primary action span the phone width; a stray `0` is visible between the subtitle and email field. Browser-saved credentials were not submitted. | Needs source recovery for the login component; checkout contains only the compiled app bundle and no source map |
| Courses | Catalogue cards stack in one column; search and course actions remain within the viewport. | Pass at reviewed viewport |
| Student Registrations / Enrolled Students | At 430px, summary cards and directory filters fit the content width; the 766px approval queue table is contained in a 351px horizontal scroller, with no page-level horizontal overflow. | Usable at reviewed viewport; approval queue requires internal horizontal scroll |
| Training Form Editor | At 320px, the editor remains within a 255px scrollable pane; field rows fit without horizontal overflow and Save draft, Publish new version, and Preview remain reachable in the sticky footer. | Pass at 320px; editor opened read-only and no changes saved |
| Staff Capture Registration Form | At 430px and 320px, form fields stack to one column; at 320px the submit button spans 243px by 50px, signature canvas fits the 214px form column, and the page has no horizontal overflow. | Pass in staff mode at reviewed widths; no registration submitted |
| Public Student Registration Form | The unauthenticated in-app browser shows the generic unavailable message, while the authenticated browser automatically enters staff-capture mode for this form. The normal public form layout could not be reviewed in this session. | Not assessed; public-mode rendering remains unresolved |
| Candidate Applications | At 430px, the list filters and form actions fit; application details scroll within the dialog and long response tables use internal scrollers. At 320px, the three detail actions previously compressed and “Print application” overlapped its neighbors. They now stack full-width with at least 48px height; all labels fit at 430px and 320px with no page-level horizontal overflow. | Fixed and production-verified at 430px and 320px |
| Lead Pipeline | Embedded workspace fills the screen. At 320px, summary cards and the 2356px board use internal scrollers with no page-level overflow; view tabs now use a two-by-two grid so all four buttons are fully visible and their labels fit. At 430px all four tabs remain visible. | Fixed and production-verified at 320px and 430px; board columns require internal horizontal scroll |
| Lead Reports | At 320px, embedded document width is 305px with no horizontal overflow. All four tabs fit in a two-by-two grid; filter controls are 216px wide inside the 245px panel, and Run report is 216px by 41px. Report/schedule GET endpoints returned 200, but the report stayed on its loading message and no results table rendered. | Controls fit at 320px; report output remains unverified |
| Phonebook | Wide contact catalogue uses an internal horizontal scroll area; its scrollbar is visible and the page controls remain reachable. | Usable at reviewed viewport; horizontal table scroll required |
| Invoices & Payments | At 430px, search/course/date filters and the Create invoice action fit. The 640px invoice table is inside a 359px horizontal scroller; the page itself has no horizontal overflow. | Usable at reviewed viewport; invoice table requires internal horizontal scroll |
| Finance Reports | The tested URL still rendered the invoice register. Route behavior needs a separate functional audit. | Not assessed for report layout |
| Tasks | Header, owner filter, status filter, refresh and paging fit the viewport. | Pass at reviewed viewport |
| Team Access | Role editor, permissions and member sections stack in a single column. | Pass at reviewed viewport |
| Agent Login / Add Agent | At 320px, the Add Agent form stays within the viewport. The Agent list grid is 1015px wide inside a 295px horizontal scroller; the page itself stays 320px wide. | Usable at reviewed viewport; agent grid requires internal horizontal scroll; no agent created |
| WA Chatbot | Bot card and Add/Assign actions fit the viewport. | Pass at reviewed viewport |
| FAQs | Text and empty-state actions fit the viewport. | Pass at reviewed viewport |
| Automation Flows | Builder toolbar and canvas fit; small canvas nodes rely on the existing zoom controls. | Partial review |
| Campaign Dashboard | Summary cards use two columns without clipping. | Pass at reviewed viewport |
| Send Campaign | Template search, status selector, refresh and setup warning stack within the screen. No campaign was sent. | Pass at reviewed viewport |
| Create Meta Template | Wizard choices stack in one column and remain readable. Later steps not inspected. | Partial review |
| Admin Manage Plans | Plan cards stack and Edit/Delete actions span the card width. | Pass at reviewed viewport |
| Admin Sign-In | Admin card, email/password fields, password visibility control and primary action fit within the phone width. | Pass at reviewed viewport; saved browser credentials were not submitted |
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
| Business navigation drawer | Search and close controls are visible; the grouped menu scrolls vertically inside the drawer. | Pass at reviewed viewport |
| Public installment reminder preferences | Action buttons stack full-width with a 48px minimum height at phone widths. Release/container/served hashes match; valid reminder-link visual review remains open. | Fixed and production asset-verified; visual review pending |

## Remaining inventory

Re-authenticate the business and platform accounts in their respective tabs before continuing interactive production review. The browser offered a saved identifier that did not match the account shown in the earlier session, so it was not submitted. The session expired during navigation to some settings.

Business screens still to review:

- Add WhatsApp by QR, Link Meta WhatsApp, later Create Meta Template steps, and the Web Notifications control.
- Agent Task, course creation/edit screens beyond the reviewed form editor, student profiles/attendance/payment details (no enrolled profile was available), form creation flow and application print output, plus Finance sub-screens beyond the invoice register.
- Public training-form/staff-capture pages, customer document pages, and installment-reminder preference pages.
- Lead Reports at smaller widths, Call Center, Commission Policy, Organization, Sales Overview, Sales Targets, Sales Deals, Commissions, Sales Finance, and all role-specific states.
- Sales Overview navigation redirected this business account to Dashboard, so sales-only screens need an account with the required role/access before mobile review.
- Inbox conversation pane and actions, once an approach is confirmed that does not change message read state.

Admin screens still to review:

- Social Login, Flow Builder Template create/detail states, Theme Settings edit/create states, full Site Settings and SMTP form scrolling, Payment Gateway expanded states, and all remaining settings.
- QR/Meta credential setup, Web Notification and Manual Web Push (currently marked PRO add-on required), Telegram Config (PRO add-on required), and platform-staff/Asterisk screens.

Repeat critical screens at narrower phone widths and in Arabic/RTL. The Finance Reports menu currently lands on the invoice register at `section=reports`; its separate report layout was therefore unavailable for this mobile review. The shared embedded-workspace fix also covers Call Center, commission, sales finance, organization and task frames; only Lead Pipeline/Reports and Tasks were visually reviewed. The sign-in implementation is present only in the compiled app bundle in this checkout; there is no source map or maintained source file available to fix the stray `0` without recovering source first.
