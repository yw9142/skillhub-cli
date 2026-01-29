# SkillHub CLI (Gist Edition)

SkillHub is a small CLI that syncs your local AI agent skills (managed by `npx skills`)
with a single GitHub Gist. The Gist acts as a free, serverless backup so you can
recreate your skill setup on any machine.

## Features

- **Login** with a GitHub Personal Access Token (classic) that has `gist` scope
- **Sync** local skills with a remote Gist:
  - Push new local skills up to Gist
  - Pull missing skills down from Gist and install them globally
  - Simple merge strategies (`union` and `latest`)

## Installation

From the project root:

```bash
npm install
npm run build
npm link        # optional, to get a global `skillhub` command
```

Alternatively, you can run it without linking:

```bash
npm run build
node bin/skillhub.js <command>
```

If you published this package to npm, you can run it with `npx`:

```bash
npx @yw9142/skillhub-cli <command>
```

## Commands

### `skillhub login`

Registers a GitHub token locally so the CLI can talk to the Gist API.

The command will:

1. Prompt for a token:
   - Create a **Personal Access Token (classic)** in GitHub
   - Grant at least the **`gist`** scope
2. Verify that the token is valid and can access Gists
3. Store the token locally using [`conf`](https://www.npmjs.com/package/conf)

If login fails, the CLI explains that the token is invalid or missing gist
permissions, and you can paste a new one.

### `skillhub sync`

Synchronizes your local skills with the remote Gist.

```bash
skillhub sync
skillhub sync --strategy union
skillhub sync --strategy latest
```

#### What “sync” actually does

1. **Read local skills**
   - Runs `npx skills list -g` and parses the global skills:
     - For example:

       ```text
       Global Skills

       vercel-composition-patterns ~\.agents\skills\vercel-composition-patterns
       vercel-react-best-practices ~\.agents\skills\vercel-react-best-practices
       ```

   - Falls back to `npx skills generate-lock` + searching for a
     `skills-lock.json` file when necessary.

2. **Read remote skills (from Gist)**
   - Looks for a private Gist that contains `skillhub.json`
   - If not found, creates a new Gist

3. **Merge local vs remote**
   - **`union` (default)**:
     - Takes the set union of local and remote skill names
     - Any skills only on Gist are installed locally
     - Any skills only on local are written to Gist
   - **`latest`**:
     - Compares `updatedAt` timestamps in the payloads
     - If remote is newer:
       - Installs skills that are missing locally
       - Gist is treated as the source of truth
     - If local is newer (or timestamps are invalid):
       - Overwrites the Gist with local data

4. **Apply changes**
   - For skills that exist remotely but not locally, SkillHub runs:

     ```bash
     npx skills add "<owner>/<repo>" --skill "<skill-name>" -g -y
     ```

   - For skills that exist locally but not in the Gist, the CLI updates
     `skillhub.json` in the Gist to reflect the union

5. **Summary output**

After a run you’ll see a short summary like:

```text
Uploaded 1 change, installed 0 skills
Uploaded 0 changes, installed 4 skills (1 install failed – check logs)
```

## Gist Payload

The Gist file `skillhub.json` stores both the skill name and its source repo
(so you can install skills from repos other than `vercel-labs/agent-skills`):

```json
{
  "skills": [
    { "name": "vercel-composition-patterns", "source": "vercel-labs/agent-skills" },
    { "name": "my-custom-skill", "source": "yw9142/my-agent-tools" }
  ],
  "updatedAt": "2026-01-29T07:27:53.844Z"
}
```

- `skills`: list of installed skills + where they came from (`owner/repo`)
- `updatedAt`: ISO timestamp when the payload was last written

This keeps the format easy to inspect and edit directly in GitHub if needed.

## Typical Workflows

### First machine (create backup)

```bash
# 1) Install skills using the official CLI
npx skills add vercel-labs/agent-skills --all -g -y

# 2) Login once
skillhub login

# 3) Push your current skills to Gist
skillhub sync
```

### New machine (restore from backup)

```bash
# 1) Install and build SkillHub CLI
npm install
npm run build
npm link

# 2) Login with the same GitHub account/token
skillhub login

# 3) Pull skills from Gist and install missing ones
skillhub sync
```

## Notes and Limitations

- Local discovery uses `npx skills list -g` as the primary source. That output
  usually does **not** include `owner/repo`, so SkillHub may fall back to a
  default source (`vercel-labs/agent-skills`) unless it can infer a source from
  `skills-lock.json`.
- For installs, SkillHub uses the stored `source` per skill:

  ```bash
  npx skills add "<owner>/<repo>" --skill "<skill-name>" -g -y
  ```

  If a skill name doesn’t exist in that repo, the install will fail but the
  overall sync will continue.
- The CLI currently focuses on **global** skills (`skills list -g`),
  not project-scoped skills.
- Error messages try to surface both:
  - Which step failed (local list / lock file / install / Gist)
  - The underlying CLI output for easier debugging
