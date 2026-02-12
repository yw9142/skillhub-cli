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

### Auth

```bash
skillhub auth login
skillhub auth status
skillhub auth status --json
skillhub auth logout
skillhub auth logout --yes
skillhub auth logout --json
```

- `auth login`: prompts for a GitHub PAT (classic, `gist` scope), verifies access, and stores it via `conf`
- `auth status`: shows login state, gist id, last successful sync timestamp, local skill count, and Gist API accessibility
- `auth logout`: clears stored session keys (`githubToken`, `gistId`, `lastSyncAt`)

### Sync

`skillhub sync` requires a subcommand.

```bash
skillhub sync pull
skillhub sync push
skillhub sync merge
skillhub sync auto
```

Common options:

```bash
--dry-run   # compute plan only (no install/remove/upload/config write)
--json      # single JSON output object
```

`pull` only:

```bash
--yes       # skip deletion confirmation prompt
```

Mode behavior:

- `pull`: mirror remote to local (remote -> local). Installs missing local skills and removes extra local skills.
- `push`: mirror local to remote (local -> remote). Updates/creates remote Gist payload from local skills.
- `merge`: union local + remote, installs missing local skills, uploads when remote differs.
- `auto`: compare `remote.updatedAt` and local `lastSyncAt`; install from remote when remote is newer, otherwise upload local when needed.

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

Backward compatibility for legacy `skills: string[]` payloads is preserved.

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

CI release workflow publishes to GitHub Packages only:

- GitHub Packages publish uses `GITHUB_TOKEN` by default.
- If needed, add `GH_PACKAGES_TOKEN` (PAT with `write:packages`) for GitHub Packages.
- GitHub Packages target package is `@yw9142/skillhub-cli`.

npmjs publish is manual.

