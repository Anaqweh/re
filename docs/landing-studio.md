# INEXC Landing Studio

The additive module appears in the existing admin as **صفحات الهبوط**. It preserves the existing courses, message centre, login and subscriber suppression flows.

## Content and operation

- Four authored starting points: أثر (programme), لقاء (workshop), مدار (teams), معرفة (guide). Arabic and English are separate initial content choices; changing an existing page's language changes direction and UI text, not the author's prose.
- Template content is an editable editorial starting point. It contains no invented testimonials, customer counts, accreditation, prices, dates or contact numbers. The owner reviews and publishes each page explicitly.
- The editor provides 12 section types, hide/reorder/duplicate/delete, structured action buttons, 30 font choices, image uploads, sharing metadata and live device previews.
- A page has a mutable draft and a separate published snapshot. Autosave never publishes. Publishing and restoring use a version check to prevent overwriting another editor. The latest 20 saved versions are retained. Local recovery and undo supplement server saves.
- Public URLs are server-rendered at `https://api.inexctraining.com/api/landing/<slug>`. HTML includes canonical, description and Open Graph metadata. An unavailable/unpublished page returns 404.
- Public forms create records only in `landing_page_leads`, with the wording of the consent given and the published page version. There is no email/WhatsApp send, payment, registration confirmation, tracking pixel, or automatic addition to marketing lists. Existing permanent email suppressions are not changed.
- Request retries are idempotent; submissions require consent and valid name/email, with a honeypot and per-email limit. Administrators can search, change status, keep private notes, export CSV (up to 10,000 filtered records), and explicitly delete requests.
- JSON exports contain page content, never leads. HTML exports display the design and link the form action to an already-published page. External image/font URLs need an internet connection; a detached export does not collect requests.

## Deployment

Run `scripts/deploy-landing-pages.sh` with a full release commit SHA on the existing droplet. It backs up the API files, installs the additive database tables on startup, checks `landingPagesVersion: 1`, and rolls back application files/container if checks fail. It does not publish a page or send test messages. Previously authorised queued/scheduled email campaigns continue through the existing worker.

`LANDING_PUBLIC_ORIGIN` can override the public API origin when hosting changes. Keep it consistent with the actual HTTPS API host. The existing CORS configuration also recognises this same origin for public form POSTs.

The static `landing-preview.html` is an interactive, non-indexed design gallery. Its preview forms do not submit data. The admin can preview designs before the matching API has been activated.

## Checks

```sh
cd inexc-api
node --test --test-concurrency=1 test/*.test.js
```

Browser integration runs against disposable PGlite, local HTTP and a recording email stub; no real messages are sent. Set `INEXC_TEST_CHROMIUM` and `INEXC_TEST_ARTIFACTS`, then run `test/landing-browser.cjs` and `test/landing-editing-browser.cjs` with the installed Playwright runtime.
