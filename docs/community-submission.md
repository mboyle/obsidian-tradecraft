# Obsidian community plugin submission

Obsidian does not require a second long-form marketing page. The Community directory uses `manifest.json` for plugin metadata and shows an excerpt from the repository's `README.md` on the public listing. Relative README images are rewritten to resolve against the repository.

## Directory metadata

The public product name is **Fieldkit**. The installed plugin ID and community URL slug remain `tradecraft` to preserve existing settings and updates. The manifest metadata is:

```json
{
  "id": "tradecraft",
  "name": "Fieldkit",
  "author": "Michael Boyle",
  "description": "Contextual backlinks, readable Daily Note dates, compact week navigation, and a continuous desktop timeline."
}
```

The directory processes `manifest.json` from the default branch. The ID must remain unique; the public name must also be unique.

## Release checklist

- Confirm `manifest.json`, the README, screenshots, and directory metadata consistently use Fieldkit.
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

## Fieldkit migration — November 23, 2026

- Rename the product from Tradecraft to Fieldkit and transfer the existing repository from `mboyle/obsidian-tradecraft` to `tradecraftso/fieldkit`, preserving history and releases.
- Requested community slug: `fieldkit`. The published ID is currently `tradecraft`; retain it in release manifests until Obsidian provides migration instructions.
- The current [Community directory FAQ](https://docs.obsidian.md/community-directory/faq) requires an admin request in Discord's `#community-directory` for GitHub repository changes. Published identifier changes also require help there, reset download counts, and require users to reinstall.
- `obsidianmd/obsidian-releases/community-plugins.json` is now an hourly mirror of the community directory. A directory PR documents the requested name and repository change but cannot by itself update the canonical directory.

### Admin request

I am Michael Boyle (`mboyle`), the original author and owner of the Tradecraft Obsidian plugin (current ID `tradecraft`). Please update its public name to Fieldkit and its repository from `mboyle/obsidian-tradecraft` to `tradecraftso/fieldkit`. I authorize this move and administer the destination organization. I also request the community URL slug `fieldkit`. If this requires changing the published plugin ID, please advise on the supported migration before changing it; the release manifest currently retains `tradecraft` so existing users can continue updating.

## Moderator guidance and final identity — November 24, 2026

[Obsidian moderator Zachatoo replied](https://discord.com/channels/686053708261228577/1574548198364676116) on November 23 that the community URL slug must match the installed plugin ID and IDs of published plugins cannot be changed. A new `fieldkit` ID would require publishing a separate plugin. The listing name can be changed by the owner in the community directory, and the directory should automatically follow the transferred GitHub repository.

On November 24, Michael accepted retaining `tradecraft` and authorized updating the existing listing name and verifying its repository. This supersedes the earlier request for a `fieldkit` slug; no separate plugin will be published as part of this migration. The intended final identity is:

- Public name: **Fieldkit**
- Installed plugin ID and community URL slug: `tradecraft`
- Repository: `tradecraftso/fieldkit`

Keep the original admin request above as history. Verify the live community listing before reporting its display name or repository mapping as updated.

### Live listing verification — November 24, 2026

The existing [community listing](https://community.obsidian.md/plugins/tradecraft) now displays **Fieldkit**. Its **View on GitHub**, **Report bug**, and **Request feature** links point to `tradecraftso/fieldkit`. The install link still uses `obsidian://show-plugin?id=tradecraft`. A manual **Check for new releases** detected manifest version 0.4.9 and queued its scan; the public current-version field still showed 0.4.8 when this verification was recorded.
