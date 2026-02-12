# SkillHub CLI

Sync local AI agent skills (`npx skills`) with a private GitHub Gist.

## Quick Start

```bash
npm install
npm run build
npm link
```

Run without linking:

```bash
node bin/skillhub.js <command>
```

Published package:

```bash
npx @yw9142/skillhub-cli <command>
```

## Commands

### Login

```bash
skillhub login
```

- Prompts for a GitHub PAT (classic, `gist` scope)
- Verifies token + Gist API access
- Stores token locally via `conf`

### Sync

```bash
skillhub sync
skillhub sync --strategy union
skillhub sync --strategy latest
skillhub sync --dry-run
skillhub sync --json
```

- `union`: merge local and remote skills, install missing local skills, upload only when changed
- `latest`: compare `remote.updatedAt` and local `lastSyncAt`
- `--dry-run`: compute plan only (no install, no Gist update, no config write)
- `--json`: single JSON output object

### Status

```bash
skillhub status
skillhub status --json
```

Shows:

- login state
- stored gist id
- last successful sync timestamp
- local skill count (if available)
- remote Gist API accessibility

### Logout

```bash
skillhub logout
skillhub logout --yes
skillhub logout --json
```

Clears stored session keys: `githubToken`, `gistId`, `lastSyncAt`.

## Payload Format

`skillhub.json` in Gist:

```json
{
  "skills": [
    { "name": "vercel-composition-patterns", "source": "vercel-labs/agent-skills" }
  ],
  "updatedAt": "2026-01-29T07:27:53.844Z"
}
```

Backward compatibility for legacy `skills: string[]` is preserved.

## Local npm Credentials

If you need npm auth, copy `.npmrc.example` to `.npmrc` and keep it local only.

## Release (Changesets)

Create release note:

```bash
npm run changeset
```

Version packages:

```bash
npm run version-packages
```

Publish:

```bash
npm run release
```

CI release workflow requires:

- GitHub Packages publish uses `GITHUB_TOKEN` from Actions.
- Package is published to GitHub Packages as `@yw9142/skillhub-cli`.
