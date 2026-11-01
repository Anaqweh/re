# Project submission dates

Each course portal has optional opening and closing instants stored in UTC (`opens_at`, `closes_at`). Admin datetime inputs display UAE time, with an explicit +04:00 conversion independent of the browser timezone. Public dates render using Asia/Dubai.

Empty opening means immediate access to submissions; empty closing means no deadline. When both are supplied, closing must be strictly later. Old frontend requests omitting both fields preserve any saved schedule. Both fields must be supplied together when changing/removing the schedule. Existing portals default to no dates; no existing submissions change.

Schedules govern new submissions only: the private project link, instructions and teaching downloads remain accessible before opening and after closing. Admin uploads remain available. Globally disabling the link still blocks all public access.

Server checks database clock after acquiring the portal row lock, before committing a new submission and its email queue entry. Opening is inclusive, closing exclusive. The upload must finish and pass the locked acceptance check before closing. Rejected uploads are cleaned up and queue no email. Retrying an already accepted identical request is acknowledged even after closing without another record or message.

Public page uses server time for initial clock alignment and updates availability while open. Server remains authoritative if dates are changed while the trainee page is open. Extending the deadline or removing dates reopens submission on page refresh.

Deploy `scripts/deploy-project-dates.sh` at the reviewed commit before merging frontend. Changes only server.js and course-projects.js, with hash checks, backups and image/file rollback. Dockerfile and approved email template are unchanged. Health reports courseProjectsVersion 3. Startup probes suppress expected empty/invalid JSON while waiting for readiness.
