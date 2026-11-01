# Multiple files and project receipts

Admin: up to 10 files selected, uploaded separately with per-file retry IDs. Retry preserves accepted progress; changing selection starts a new batch. Each prepared file <= 10 MiB, selection total <= 50 MiB.

Trainee: up to 10 files, automatically bundled into one ZIP for a single atomic submission and receipt. Final payload <= 10 MiB; selection total <= 50 MiB. Existing single-file API remains compatible. No external compression service. ZIP preserves arbitrary file bytes. Optional, enabled-by-default JPEG/WebP reduction above 2 MiB: max dimension 2560, quality .86, retain original when savings <10%; UI warns of reduced resolution. PNG, PDFs, archives, videos and other formats are not rewritten. Native deflate is used when available and beneficial; otherwise stored ZIP. Unsupported/oversized files produce an error, never a false success.

Email renderer: inexc-api/project-receipt.js. Preview sent through Gmail outside site, message 1a198c084fc758ac, to ahmadanakwa@gmail.com. Readback text/html exactly matched generated HTML. Ahmed explicitly approved it on 2026-11-02 UAE. Production uses the same template with trainee values. Preview reference is explicitly a non-production example.

Receipt row created atomically with a successful new submission when email is provided and mail is enabled. No retroactive emails. Snapshot of rendered message is persisted, queue claims use SKIP LOCKED, provider idempotency key is stable, retries limited to 5 within 23 hours of first attempt; uncertain exhausted/expired sends require review. Provider acceptance is recorded, not inbox delivery. Suppression checked before send. Worker starts on server and runs every minute regardless of admin/browser state. Admin sees receipt status beside submissions.

Deploy backend with scripts/deploy-project-receipts.sh using exact reviewed commit, then publish frontend. Baseline hashes guard API and reviewed Dockerfile variants; preserve live Dockerfile, append COPY, back up and roll back files/image on failed health check. Additive queue schema retained. No production test submissions needed. Existing scripts/workers resume on restart.
