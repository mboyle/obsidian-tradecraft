# Obsidian community plugin submission

Obsidian does not require a second long-form marketing page. The Community directory uses `manifest.json` for plugin metadata and shows an excerpt from the repository's `README.md` on the public listing. Relative README images are rewritten to resolve against the repository.

## Proposed directory metadata

The public product name and stable plugin ID are both **Tradecraft**. The manifest metadata is:

```json
{
  "id": "tradecraft",
  "name": "Tradecraft",
  "author": "Michael Boyle",
  "description": "Contextual backlinks, readable Daily Note dates, compact week navigation, and a continuous desktop timeline."
}
```

The directory processes `manifest.json` from the default branch. The ID must remain unique; the public name must also be unique.

## Release checklist

- Confirm `manifest.json`, the README, screenshots, and directory metadata consistently use Tradecraft.
- Set the release version in `manifest.json`, `package.json`, `package-lock.json`, and `versions.json`.
- Run `npm run check` and complete desktop and mobile acceptance testing.
- Create a GitHub release whose tag exactly matches `manifest.json`'s version (for example, `0.3.0`, without a leading `v`).
- Attach `main.js`, `manifest.json`, and `styles.css` to the GitHub release.
- Sign in at `community.obsidian.md`, connect the GitHub account that owns the repository, and submit the repository URL from the Plugins section.
- Address any automated scanner or reviewer feedback with an incremented version and matching GitHub release.
- Replace the README's manual-installation lead with Community Plugins instructions after approval.

Official guide: <https://docs.obsidian.md/plugins/releasing/submit-plugin>

## Artwork

The README includes desktop and iPhone captures for contextual linked references, Daily Note navigation, and the continuous timeline. Keep future screenshots in `docs/images/`, use the demo vault only, and avoid notifications or personal content.
