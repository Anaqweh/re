# Course content and artwork — 16 October 2026

Requested scope: complete each existing course/diploma with a relevant curriculum, outcomes, audience, prerequisites, project, trainer and meeting dates, and replace logo-only course artwork with individual covers. Starts are scheduled 23–30 October 2026 in Asia/Dubai. Eleven existing IDs are retained, including the existing Claude diploma. Prices, total hours, certificates, payment settings, registration records and messaging schedules are unchanged.

The first description paragraph is the card summary. `## ` headings in the editable description hold the audience, preparation, practical project and weekly schedule. Main axes are individual expandable groups on the detail page. The existing Claude curriculum is retained and a website-building axis is added to match its title and promised output. All eleven programs now have distinct generated editorial covers; they are illustrative artwork, not photographs of actual trainers or classes.

| Program | First session (Dubai time) | Meetings | Total hours | Last session |
|---|---|---|---|---|
| Prompt engineering | 23 Oct, 16:00–19:00 | 2 Fridays | 6 | 30 Oct |
| NotebookLM | 23 Oct, 19:30–22:30 | 2 Fridays | 6 | 30 Oct |
| Assessment and Rubrics | 24 Oct, 10:00–13:00 | 2 Saturdays | 6 | 31 Oct |
| Canva | 24 Oct, 14:00–17:00 | 2 Saturdays | 6 | 31 Oct |
| Claude interactive tools | 24 Oct, 18:00–20:00 | 4 Saturdays | 8 | 14 Nov |
| AI in teaching diploma | 25 Oct, 17:00–20:00 | 8 Sundays | 24 | 13 Dec |
| Instructional design diploma | 26 Oct, 18:30–21:30 | 8 Mondays | 24 | 14 Dec |
| Assessment analytics diploma | 27 Oct, 18:30–21:30 | 8 Tuesdays | 24 | 15 Dec |
| AI agents diploma | 28 Oct, 18:30–21:30 | 10 Wednesdays | 30 | 30 Dec |
| Educational websites diploma | 29 Oct, 18:30–21:30 | 10 Thursdays | 30 | 31 Dec |
| Existing applied Claude diploma | 30 Oct, 10:00–13:00 | 5 Fridays | 15 | 27 Nov |

All meeting durations sum to the existing course hours, with no trainer overlap. The owner requested the date window; these are authored schedules and remain editable, not inferred historical events. No automated reminders were created.

## Applying the data

Run `scripts/deploy-course-content.sh` on the existing droplet with a full published commit SHA. It downloads and verifies the eleven WebP files, then runs a standalone data updater inside the existing API container. It does not rebuild/restart the API or import `server.js` and its workers.

The updater verifies the expected original content, locks the eleven rows, saves the previous changed fields in `course_content_updates.before_content`, and commits all course changes in one transaction. A missing course, changed original content or invalid image stops the update. It never changes active flags, prices, certificates, payment links or bank settings. Re-running the same batch preserves later admin edits. Previous uploaded images remain intact. Future standard deployments do not reapply this batch.

Image prompts and asset paths: `docs/course-artwork-20261016.json`. The built-in image generator produced the artwork; WebP encoding changes file format only, without compositing or resizing.

## Content references checked

The curriculum and schedules are authored for INEXC. These primary product sources were consulted only to verify general capabilities; no quotas or guaranteed plan access are promised:

- https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them
- https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects
- https://blog.google/innovation-and-ai/products/notebooklm-audio-video-sources/
- https://www.canva.com/create/ai-presentations/

Verification uses an isolated PGlite database and JSDOM with synthetic course fetches. No production registration forms or mail endpoints are exercised.
