# Course reviews and free registration

Administrators add/edit names and opinions in «تجارب المتدربين». Select an original course and one or more display courses. Only visible/featured reviews display. Remove a course selection to hide a review there, or choose hidden/draft to hide it everywhere. Existing reviews have no course placements by default; homepage behaviour is preserved. This change does not add a visitor submission form.

Free course CTAs retain their course ID. Existing card checkout and optional certificate charges are preserved. The free-plan guide no longer redirects to unrelated paid packages when no eligible free plan is found.

## Deployment order

1. On the existing API droplet, run `bash scripts/deploy-course-reviews.sh FULL_REVIEWED_COMMIT_SHA` using this branch's script. It requires the exact reviewed baseline server file and refuses to overwrite production changes. It backs up server.js and rolls back the previous image if health checks fail. Existing scheduled workers resume their configured schedules; no new mail, registration or payment is requested by this deployment.
2. After API health succeeds, merge the frontend PR into master for GitHub Pages.
3. Verify an administrator can save course placements, then check a real published course on desktop/mobile. No invented reviews have been seeded.

Validation: 18 passing tests covering course identity in links, free/paid transitions, certificate selections, review filtering by publication and course, escaped review text and admin script syntax. Live deployment and visual review remain pending server access.
