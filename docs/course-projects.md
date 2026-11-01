# Private course project portal

Admin navigation: «مشروعات الدورات», plus a shortcut in the course edit form. Select a saved course, save title/instructions/enabled state, copy its private link, upload supporting materials, and review/download submissions. Link creation does not send messages. Links persist until rotated; disabling blocks reads, uploads and material downloads. Re-enabling retains the same link.

The 256-bit random bearer link opens `/course-project.html?key=...`. Anyone with that link can read materials and submit a project. It is not an identity/attendance verification mechanism. It is not listed publicly or added to sitemaps. It sends no referrer and has noindex/nofollow. Public responses never expose submissions, participant details or stored filenames.

Submissions accept name, optional email, project title, description, and one file of any format up to 10 MiB. Multiple-file projects can be ZIP archives. All files are stored under the pre-existing blocked `/uploads/trainee-private/projects` directory, with random internal names. Downloads are served as attachments with octet-stream, nosniff and sandbox headers; the app never executes or previews uploaded code. No antivirus scanning is claimed. Administrator downloads require auth; public downloads require an enabled token and only permit materials in that same course.

Storage cap: 1 GiB/course, maximum 100 teaching materials/course, up to 100 submissions/network/course/hour. Failed writes clean up uploaded files. Request IDs and content fingerprints avoid duplicate records after retries. Course-row locks serialize quota checks. Admin submissions are paginated, 100/page. New data is independent of registration/payment/email workflows.

Deployment: run `scripts/deploy-course-projects.sh FULL_SHA` on the existing droplet before publishing frontend. It verifies server.js and Dockerfile hashes against the reviewed baseline, backs up only the three changed API files and previous image, and rolls back on failed checks. No DB tables or submissions are deleted by rollback. User must create/save each course portal in admin after deployment.

Local checks cover cross-course material access, hidden submissions, admin-only download, non-executable download headers, blocked static private files, retry idempotency and link rotation. Live end-to-end upload has not been performed; no fake projects or emails were created.
