# Chrome Web Store release preparation

## Current status (September 25, 2026)

AnyAnnotate 0.6.3 is published on the Chrome Web Store under the existing item ID and OAuth clients (listing updated September 15, 2026). Version 0.6.4 was submitted for review on September 25, 2026, and the dashboard shows **Pending review**. The live listing keeps its 0.6.3 content until the review passes.

Version 0.6.4 completes the rename inside the code. It moves browser-local data to a renamed IndexedDB database once, writes new Google Docs duplicate-protection markers while recognizing earlier ones, and moves the homepage, privacy policy, and support links to the `anyannotate` repository and GitHub Pages site. The store ID, public key, and both OAuth clients are unchanged, so existing installations update in place.

### Rename follow-up (completed September 25, 2026)

1. The GitHub repository was renamed to `anyannotate`, and its website field points to the new Pages site. GitHub redirects the old repository and git URLs, but not the old GitHub Pages address, which now returns 404 until the store listing update is live.
2. https://guoziyu415.github.io/anyannotate/ and https://guoziyu415.github.io/anyannotate/privacy.html are live without the previous name.
3. Google Search Console verified the new homepage as a URL-prefix property with the existing `google-site-verification` tag in `website/index.html`. Keep that tag.
4. Google Cloud **Branding** shows the app name AnyAnnotate with the new homepage and privacy policy links. The project display name and both OAuth client names were renamed; the project ID cannot change. The Verification Center still reports that branding is not shown to users, so branding and sensitive-scope verification remain open.
5. In the Chrome Web Store dashboard, the 0.6.4 package was uploaded, the previous-name notice was removed from the description, three new 1280 x 800 screenshots replaced the old ones, the homepage, support, and privacy policy URLs were updated, the test instructions below were saved, and the item was submitted for review.
6. A macOS 0.3.0 release has not been published yet. Build it with `./scripts/build-app.sh` and `./scripts/package-macos-app.sh`.

Saved test instructions for 0.6.4:

> 0.6.4 completes the AnyAnnotate rename; same extension ID and OAuth clients. It migrates local data once and keeps existing notes. Local: on HTTP/HTTPS, select text > Annotate > add note > choose Markdown/TXT/Local inbox > Save. Optional Google Docs: Settings > Connect Google > create a Doc or paste its URL, then save/export. OAuth branding and scope verification are pending.

Repository-independent identities are deliberately unchanged: the store ID and public key, both OAuth clients, and the Google Cloud project. User-created document titles and existing notes are not renamed.

## AnyAnnotate 0.6.3 submission (September 13, 2026)

On September 13, the maintainer explicitly requested submission of the renamed version. The dashboard required cancellation of the existing 0.6.2 review before accepting a new package. It confirmed **Review canceled** for 0.6.2, accepted **AnyAnnotate - Web Highlights & Notes**, version **0.6.3**, and then confirmed **Pending Review** and **Item submitted**. Google OAuth branding was not changed.

Uploaded archive: `AnyAnnotate-Chrome-Web-Store-v0.6.3.zip`, SHA-256 `2fca3a6f77741203d8c738b8a11b543d60bfc7d26d7a7cfbf161cbebfee2d533`. The English description gained a notice about screenshots and Google consent branding that still showed the previous name. Existing permissions, category, language, links, icons, and screenshots were retained.

## Previous 0.6.2 submission and save regression

Checked on September 12, 2026. At the maintainer's explicit request, the 0.6.1 review was canceled and replaced with version 0.6.2. The dashboard confirmed **Review canceled**, accepted package version **0.6.2**, then confirmed **Pending review** and **Item submitted** for the replacement. Automatic publication after approval remains selected. This is not an approved or public listing.

After the initial submission, the maintainer reported a real Google Docs save failure after loading the updated extension. The screenshot confirms that the local inbox backup succeeded while the Google operation failed; the server's precise rejection was hidden by the generic error message. Version 0.6.2 is a repair candidate with explicit border reset objects, bounded error diagnostics, and a basic-format fallback for an explicitly rejected formatting request. The live Google result is **not yet verified**. The maintainer requested withdrawal and replacement after being informed of that limitation. The replacement's saved reviewer instructions explicitly disclose the unverified live repair and pending Google OAuth verification. Do not call the issue resolved until a real Google Docs write has been checked.

- Extension ID: `mkdeklipbgfjoibioofimhcklfikgmgo`
- Uploaded and submitted package version: `0.6.2`
- [Maintainer dashboard](https://chrome.google.com/webstore/devconsole/b26ec47b-5262-4b44-806c-c1f1d6ef82dd/mkdeklipbgfjoibioofimhcklfikgmgo/edit)
- Saved listing fields: English description, Tools category, English (United States), the 128 x 128 icon, two 1280 x 800 screenshots, homepage URL, support URL and privacy policy URL.
- The source repository is public, including its existing commit history, with the maintainer's approval.
- The English [homepage](https://guoziyu415.github.io/anyannotate/) and [privacy policy](https://guoziyu415.github.io/anyannotate/privacy.html) are publicly hosted on GitHub Pages. The site returned HTTP 200 at its earlier address after the [website deployment](https://github.com/guoziyu415/anyannotate/actions/runs/34688870812); recheck both links after the repository rename.
- Public support contact: `guoziyu415@gmail.com`, explicitly confirmed by the maintainer. Chrome now displays **Verified email address**.
- Single-purpose description, downloads/storage/identity/host explanations, and the no-remote-code answer have been saved. Data types disclosed: authentication information, personal communications, web history (saved source pages only), and website content. The maintainer confirmed that notes stay locally or in the user's Google Docs, not in an operator database; the three limited-use certifications were saved before submission.
- Google Branding now has the product icon, homepage, privacy policy and `guoziyu415.github.io` authorized domain. Google Search Console confirmed **Ownership verified** for the homepage URL-prefix property using the HTML meta tag. Keep this tag in `website/index.html`; this is not Google OAuth approval.
- The existing Google Cloud project now displays **In production**. No new project or OAuth client was created for this transition. Automated branding verification failed with a homepage-ownership finding despite the verified Search Console URL-prefix property. An explanation requesting manual review is drafted, not submitted; URL-prefix verification must not be represented as ownership of the parent `github.io` domain.
- The combined Google review form requires both a scope justification and a real YouTube demonstration. The justification is drafted in the existing project's Data Access page, but cannot be saved without the video URL. The maintainer supplied a real recording showing local-client authorization and a Google Docs write from an older build. It has not been uploaded or submitted, does not demonstrate the store client, and does not validate 0.6.1 or the 0.6.2 repair. Saved store test instructions explicitly disclose pending Google verification and the lack of a live store-client test.
- [Store screenshot capture](https://github.com/guoziyu415/anyannotate/actions/runs/34688888427) passed all 20 browser checks and produced three 1280 x 800 RGB PNGs. The annotation and selection screenshots are suitable for the store; the settings screenshot only shows the top of the inbox section. The normal [CI run](https://github.com/guoziyu415/anyannotate/actions/runs/34688870822) passed too.
- [CI for the uploaded source](https://github.com/guoziyu415/anyannotate/actions/runs/34688017676) passed, including 40 Chrome unit tests and 20 isolated browser checks. Google identity and API responses in those tests are mocked.

The withdrawn 0.6.1 package had SHA-256 `c573380f92bfdf3947dc728caf5af5ba87012e5b8e593eb0f576b51139101397`. Its 0.6.2 replacement had SHA-256 `e198967801562898267e1f70afd558f5d24aa1180939168d6792883bc19258d0`. Both use the existing store-specific public key and OAuth client; neither changes the original local installation identity. The earlier 43 passing unit tests did not catch the live Google save failure. The 0.6.2 candidate has 49 passing automated checks, but Google verification and live external-account testing remain incomplete despite the maintainer-requested store submission.

## Preserve existing installation and store identities

The existing development OAuth client is bound to extension ID `dkgiondcoadhpmmpinjdhdhmhgmlgnpm`. It must not be overwritten just to support the store ID.

The store ID, verified public key, and separate OAuth client are recorded in [chrome-web-store.json](../config/chrome-web-store.json). These values are public application configuration, not secrets. Both existing clients remain in the same Google Cloud project. The maintainer explicitly requested promotion of this existing project instead of creating another project or client.

Treat this as the release project after promotion. Automated development tests must continue using mocked Google services, not production OAuth. Google's testing/production separation and client-readiness policies still apply; promotion is not a claim that all Google requirements or reviews have been completed. Do not delete, replace or rotate the existing installation's credentials without explicit authorization.

Run `node scripts/package-chrome-store.mjs` from the repository root to create the isolated store ZIP and checksum. The script validates the public key against the store ID and rejects the development OAuth client. It never edits the unpacked development manifest. An existing archive is not overwritten.

Do not insert this public key into an existing user's unpacked development manifest: changing the extension ID creates a separate installation and separate browser-local storage. Prepare a separate store build instead. An explicit data-migration workflow is not implemented; export important notes before switching installations and retain the development installation if full local metadata is needed.

## Remaining release gates

1. Keep the existing production project, store OAuth client and original installation client. Do not create another project or client; the maintainer explicitly declined that approach.
2. The isolated store package has been uploaded to the existing draft. Preserve this item ID for future updates and rerun validation when the configuration changes.
3. The English homepage and privacy policy are live on GitHub Pages; public email and website URL-prefix ownership are verified. Preserve the verification meta tag and confirm that Google's OAuth review accepts the supplied site.
4. Supply the real OAuth demonstration video and submit the prepared homepage-ownership explanation and scope justification. Complete branding verification/publication and sensitive Google Docs scope verification. **In production** is not **Verified**; the dashboard still shows a 100-user cap for unapproved scopes.
5. Validate Google login and saving with a real external account using the store identity. Check create/select, repeated appends and exports, failure recovery, and disconnect.
6. Two store-sized screenshots, reviewer instructions and the three confirmed privacy certifications have been saved. Remove the reviewer instructions' Google caveat only after real authorization is ready.
7. Verify the repair with a real Google Docs operation before declaring the save regression resolved. Version 0.6.1 was withdrawn and 0.6.2 is pending review at the maintainer's request; successful submission and CI are not proof of a successful live Google write, publication or approval.

## Prepared Google review material

These drafts are retained here because the dashboard cannot save the scope form without a video. They are not evidence that a review was submitted.

### Scope justification

AnyAnnotate lets users explicitly save selected excerpts and annotations to a Google Doc they create or choose by pasting an existing document URL. The documents scope is used for documents.create, documents.get and documents.batchUpdate. Reads locate the chosen tab, append position, revision and deduplication markers; writes append notes, formatting and markers. Read-only access cannot save notes. drive.file only covers files created by or explicitly opened with the app; pasting an arbitrary existing Doc URL does not grant that per-file authorization in the current workflow. We do not list, scan or delete other documents. Google requests go directly from the extension to the Docs API over HTTPS; no application server receives notes or documents. Google connection is optional and initiated by the user. Local inbox, Markdown and TXT work without Google. Both existing Chrome Extension clients use this same workflow.

### Homepage ownership explanation

The new address was verified on September 25, 2026.

The homepage is the GitHub Pages project site of the public repository https://github.com/guoziyu415/anyannotate, maintained by the GitHub account guoziyu415. Google Search Console confirmed Ownership verified for https://guoziyu415.github.io/anyannotate/ using an HTML verification tag under guoziyu415@gmail.com, the account used for this Google Cloud project. The tag remains on the live homepage. The privacy policy is publicly accessible on the same host and linked from the homepage. Please manually review this ownership evidence and let us know if verification at a different URL scope is required. We do not claim ownership of the parent github.io domain.

### Real demonstration checklist

Use the existing project and clients. The Data Access form says the video must include every OAuth client assigned to this project. Do not create a new identity, replace an installed extension's manifest key, or use mocked authorization as evidence.

1. Use English UI and synthetic sample notes in a clean demonstration window, without unrelated private tabs or documents.
2. Show the extension identity and **Connect Google** flow, including the app name, requested Docs permission and client ID in the authorization URL. Do not record passwords, verification codes or access tokens. Any security prompt requiring the account owner's decision must be handled by that owner.
3. Show creating a sample Google Doc and saving an excerpt with an annotation. Open the actual document to show the saved result.
4. Show choosing an existing sample Doc by URL and appending a second note without replacing its previous contents. Demonstrate disconnecting afterward.
5. Cover both existing clients, using separate installations if necessary so the original installation and notes remain intact. Record the actual result; a failed operation is not a successful test.
6. Upload the reviewed recording to YouTube as **Unlisted** and supply that link to the existing Data Access form. Check that it is accessible to reviewers before submitting the review.

## References

- [Chrome OAuth and consistent extension IDs](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth)
- [Google Docs authorization scopes](https://developers.google.com/workspace/docs/api/auth)
- [Google OAuth production-readiness requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
- [Google sensitive-scope verification and demonstration requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Chrome Web Store image requirements](https://developer.chrome.com/docs/webstore/images)
