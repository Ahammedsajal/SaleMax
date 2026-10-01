# SaleMaX Node local runtime

## Start and stop

Open PowerShell and run `.\start-local.ps1` from this folder. The Node app listens only on `http://127.0.0.1:3010`; local MariaDB listens only on `127.0.0.1:3307`. Run `.\stop-local.ps1` to stop both local processes.

## Included data and limits

The Node app and its database snapshot are included. The production SQL archive in `private-backups/` is retained unchanged; the working `gbot` database has been restored locally and sanitized. Provider tokens, SMTP credentials, push tokens, webhook secrets, WhatsApp auth state, user API keys, and active provider settings were cleared. Imported WhatsApp instances are marked inactive. Account password hashes and customer/business records remain for training.

Production `.env`, live WhatsApp session files, logs, Linux `node_modules`, uploaded media, and recordings were excluded. Windows Node dependencies were installed locally. The local `.env` contains generated local-only secrets. Meta, Telegram, payments, SMTP, Firebase, and WhatsApp provider operations are disconnected. Local-only mode prevents background provider workers from starting.

The production lock file did not match its package manifest (`sharp` version mismatch), so `npm install` resolved Windows dependencies and updated this local copy's `package-lock.json`.
