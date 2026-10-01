# SaleMaX user manual

Status: the upgrade is being implemented. This manual will document verified screens and real user journeys as they become available, including English/Arabic behavior. It is not a claim that planned features already work.

## Local verification environment

From the SaleMaX application directory, run `start-local.ps1` in PowerShell. Open http://127.0.0.1:3010/. The database binds to 127.0.0.1:3307. Run `stop-local.ps1` to stop this local environment. The imported training data is private and excluded from Git. Provider operations remain disconnected in local-only mode.

## Upgrade journeys to be documented

Super Admin and staff administration; business onboarding and plan assignment; team roles and seat limits; course/offer/batch setup; public and staff lead capture; assignments and follow-ups; sale approval; invoice and installment schedules; payment verification; receipt delivery; credits/refunds; reports; channel setup and delivery issues. Each journey requires tested screens, field guidance and recoverable error states before it is marked available.
