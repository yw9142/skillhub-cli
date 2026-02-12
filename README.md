# SkillHub CLI (Gist Edition)

SkillHub is a CLI that syncs your local AI agent skills (managed by `npx skills`)
with a private GitHub Gist. The Gist acts as a simple backup so you can recreate
your skill setup on another machine.

## Features

- Login with a GitHub Personal Access Token (classic) with `gist` scope
- Sync local skills with a remote Gist payload
- Merge strategies:
  - `union` (default): reconcile both sides
  - `latest`: compare remote timestamp against the last successful local sync

## Installation

From the project root:

```bash
npm install
npm run build
npm link
```

Run without linking:

```bash
npm run build
node bin/skillhub.js <command>
```

Run published package with `npx`:

```bash
npx @yonpark/skillhub-cli <command>
```

## Local npm Token Setup

If you need npm auth for GitHub Packages:

1. Copy `.npmrc.example` to `.npmrc`.
2. Fill your real token in `.npmrc`.
3. Keep `.npmrc` local only (it is gitignored).

## Commands

### `skillhub login`

Registers a GitHub token locally so the CLI can call the Gist API.

The command:

1. Prompts for a token
2. Verifies the token with GitHub API + Gist API access
3. Stores the token locally via [`conf`](https://www.npmjs.com/package/conf)

### `skillhub sync`

Synchronizes local skills with the remote Gist.

```bash
skillhub sync
skillhub sync --strategy union
skillhub sync --strategy latest
```

Invalid strategies now return an error (supported: `union`, `latest`).

#### Strategy behavior

1. `union`:
   - Builds the union of local and remote skills
   - Installs remote-only skills locally
   - Updates Gist only when skill set actually changed

2. `latest`:
   - Compares `remote.updatedAt` with local `lastSyncAt` (last successful sync)
   - If remote is newer: installs missing remote skills locally
   - Otherwise: pushes local payload to Gist when local and remote differ

On partial install failures, sync reports failed installs and exits non-zero.

## Gist Payload

`skillhub.json` format:

```json
{
  "skills": [
    { "name": "vercel-composition-patterns", "source": "vercel-labs/agent-skills" },
    { "name": "my-custom-skill", "source": "yw9142/my-agent-tools" }
  ],
  "updatedAt": "2026-01-29T07:27:53.844Z"
}
```

- `skills`: installed skills with source repo (`owner/repo`)
- `updatedAt`: ISO timestamp of the last payload write

## Security Response for Exposed Token

If a token was committed previously, complete these manual steps:

1. Revoke the exposed token in GitHub immediately.
2. Generate a new token with minimum required scope (`gist`).
3. Update local auth (`skillhub login` and local `.npmrc` if used).
4. Review package publish access/audit logs for suspicious activity.

This repository only includes `.npmrc.example`; never commit real credentials.

## Notes

- Local discovery prioritizes `npx skills list -g`.
- Fallback path uses `npx skills generate-lock` + `skills-lock.json` search.
- Skill install command uses:

```bash
npx skills add "<owner>/<repo>" --skill "<skill-name>" --global --yes
```
