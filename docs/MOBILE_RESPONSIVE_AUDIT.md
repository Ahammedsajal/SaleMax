# SaleMaX mobile screen audit

## Scope and method

Initial read-only production review on 13 October 2026 at the mobile-width in-app browser viewport (about 430 CSS pixels). Screens were opened through the existing signed-in account and reviewed for visible layout, control alignment, and clipping. No customer records, messages, settings, or campaign actions were changed. The Inbox conversation pane was not opened because doing so can mark a conversation as read.

This is a continuing screen inventory, not a claim that every role-specific or Arabic screen has passed. Screens were reviewed in English at about 430 CSS pixels, with Lead Reports also checked in Arabic/RTL. Narrower widths and the remaining administrative sections still need review. During the second pass, the admin session expired and navigation redirected to `/user/login`; the business session also expired before the Phonebook could be re-opened. No credential or OTP was entered.

## Screens reviewed

| Screen | Mobile observation | Status |
| --- | --- | --- |
| Business Dashboard | Summary cards stack cleanly; refresh and date-range controls remain visible. | Pass at reviewed viewport |
| Inbox | Chat list fits the phone width and the navigation opens as a drawer. Conversation pane not opened. | Partial review |
| Business Sign-In | Form fields and primary action span the phone width; a stray `0` is visible between the subtitle and email field. Browser-saved credentials were not submitted. | Needs source recovery for the login component; checkout contains only the compiled app bundle and no source map |
| Courses | Catalogue cards stack in one column; search and course actions remain within the viewport. | Pass at reviewed viewport |
| Candidate Applications | “Back to workspace” inherited a 180px flex basis when the mobile heading changed to a column. | Fixed and production-verified: full-width button with a 44px minimum height |
| Lead Pipeline | Embedded screen reserved 260px for the closed desktop drawer, leaving only a narrow strip of the viewport for the board. | Fixed and production-verified: full-width workspace and no background-page scrollbar |
| Lead Reports | Uses the same embedded workspace placement and showed the same narrow-strip issue. | Fixed and production-verified in English and Arabic/RTL |
| Phonebook | Wide contact catalogue uses an internal horizontal scroll area; its scrollbar is visible and the page controls remain reachable. | Usable at reviewed viewport; horizontal table scroll required |
| Invoices & Payments | Search, course/date filters, and primary action stack vertically and fit the viewport. | Pass at reviewed viewport |
| Finance Reports | The tested URL still rendered the invoice register. Route behavior needs a separate functional audit. | Not assessed for report layout |
| Tasks | Header, owner filter, status filter, refresh and paging fit the viewport. | Pass at reviewed viewport |
| Team Access | Role editor, permissions and member sections stack in a single column. | Pass at reviewed viewport |
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
- Agent Login, Agent Task, Courses/Students, form creation/editor and submitted-application detail/print screens, plus Finance sub-screens beyond the invoice register.
- Public training-form/staff-capture pages, customer document pages, and installment-reminder preference pages.
- Lead Reports at smaller widths, Call Center, Commission Policy, Organization, Sales Overview, Sales Targets, Sales Deals, Commissions, Sales Finance, and all role-specific states.
- Inbox conversation pane and actions, once an approach is confirmed that does not change message read state.

Admin screens still to review:

- Social Login, Flow Builder Template create/detail states, Theme Settings edit/create states, full Site Settings and SMTP form scrolling, Payment Gateway expanded states, and all remaining settings.
- QR/Meta credential setup, Web Notification and Manual Web Push (currently marked PRO add-on required), Telegram Config (PRO add-on required), and platform-staff/Asterisk screens.

Repeat critical screens at narrower phone widths and in Arabic/RTL. The Finance Reports menu currently lands on the invoice register at `section=reports`; its separate report layout was therefore unavailable for this mobile review. The shared embedded-workspace fix also covers Call Center, commission, sales finance, organization and task frames; only Lead Pipeline/Reports and Tasks were visually reviewed. The sign-in implementation is present only in the compiled app bundle in this checkout; there is no source map or maintained source file available to fix the stray `0` without recovering source first.
