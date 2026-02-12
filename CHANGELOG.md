# @yw9142/skillhub-cli

## 0.3.0

### Breaking Changes

- Replace top-level commands with grouped commands:
  - `skillhub auth login|status|logout`
  - `skillhub sync pull|push|merge|auto`
- Remove legacy interfaces:
  - `skillhub login|status|logout`
  - `skillhub sync --strategy ...`
  - `skillhub sync` without a subcommand

### Changes

- Add mirror-style sync modes:
  - `sync pull` (remote -> local, includes removals)
  - `sync push` (local -> remote)
- Keep union behavior under `sync merge` and latest behavior under `sync auto`.
- Add delete confirmation flow for `sync pull` with `--yes` override.
- Remove npmjs auto-publish from `.github/workflows/release.yml`; keep GitHub Packages publish.

## 0.2.0

### Minor Changes

- Add status/logout commands, dry-run/json sync output, retry hardening, and CI/release automation with Changesets.
