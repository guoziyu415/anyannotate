# AnyAnnotate Privacy Policy

Last updated: September 25, 2026

AnyAnnotate has one purpose: to let users select text on web pages, add an annotation, and save that content to a destination they choose.

## Data handling

- The extension processes text intentionally selected by the user, annotations, categories, tags, the page title and source URL, and the save time. For local HTML files, the source URL includes the file's local path.
- Local saving stores this data in the extension's local Chrome storage, a Markdown or TXT file selected by the user, or a download in the chosen format. Every saved annotation has a local backup, including Google Docs saves.
- Google Docs is optional. After connecting Google, the user can select it as the save destination or explicitly export the inbox. Those actions send the quote, annotation, source title and supported source link directly to Google's Docs API. Category, tags, and timestamps are not included in the exported document. A complete local copy remains in the inbox.
- When connecting a document or appending notes, the extension reads that document's title, tab structure, revision, content, and named ranges to find the insertion point and avoid duplicate appends. It does not list or scan the user's other Google documents.
- The extension has no server, analytics, advertising, or AI calls. It does not sell user data or transmit it to the maintainer.
- The extension does not collect the full page or save content without an explicit save action. Input fields, password fields, and editable areas are excluded from selection capture.

## Permission use

- `storage`: Stores the local annotation inbox, default file name, and related local settings.
- `downloads`: Creates Markdown or TXT downloads when the user chooses that format and clicks **Save**, or exports the local inbox. The user chooses the filename and location through Chrome's save dialog.
- `identity`: Uses Chrome's OAuth flow to connect a Google account only after the user chooses **Connect Google**. Chrome manages access tokens; the extension does not persist them in the inbox or return them to content scripts.
- `https://docs.googleapis.com/*`: Reads the chosen document and appends annotations, or creates a document when requested. The `documents` OAuth scope allows Google Docs access and is broader than one file. The extension uses it to support existing document links, operates only on the chosen document, and does not implement deletion of Google documents.
- Access to HTTP and HTTPS pages: Detects intentional text selections and displays the annotation interface on the websites you use. Chrome's site-access controls let you restrict it to selected sites.
- Access to local HTML files: Available only when you enable **Allow access to file URLs** in Chrome. The extension does not scan directories or open other files.

## Data deletion

Users can clear the local inbox from the extension popup or settings page. Uninstalling the extension also removes extension data stored by Chrome. Markdown files, TXT files, and Google documents are not deleted by these actions.

**Disconnect Google** clears this extension's cached Google authorization and its selected cloud destination, then returns new saves to local mode. Google documents already created or updated remain in the account. Users can also revoke the app's access through [Google Account connections](https://myaccount.google.com/connections).

Local notes and settings remain on your device until you clear them or uninstall the extension. Exported files and Google documents remain until you delete them in their respective locations. AnyAnnotate does not apply its own encryption to local notes or exported files; use your device's security controls to protect them. Requests to Google's API use HTTPS.

## Limited use of Google data

AnyAnnotate's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including its Limited Use requirements. It uses Google data only to provide the document-saving features you choose. It does not sell Google data, use it for advertising, credit or lending decisions, or transfer it for unrelated purposes. The maintainer cannot access your notes or Google documents through the extension.

The extension handles user data solely for its described annotation and saving purpose, consistent with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data), including its Limited Use requirements.

## Product website and support

The public product website is hosted by GitHub Pages. GitHub may process technical request information, including IP addresses, to serve and secure the website under the [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). The website has no analytics, advertising, forms, or embedded third-party trackers.

If you contact the maintainer for support, the information you choose to send is used to respond to your request. GitHub Issues are public: do not post private notes, account credentials, or personal documents there.

## Contact

For privacy questions or sensitive reports, email guoziyu415@gmail.com. For general questions, use [AnyAnnotate GitHub Issues](https://github.com/guoziyu415/anyannotate/issues). Do not send passwords, tokens, or entire private documents when asking for help.
