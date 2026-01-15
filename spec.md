# Quartermaster Command + Extension Spec

## Overview
Quartermaster is a Pi extension plus CLI command that manages **repo-local** skills, extensions, tools, and prompt templates by **symlinking** items from a shared local repository into the current repo’s `.pi/` folder. It supports installing items individually or as **sets** defined in the shared repo.

The same functionality is exposed as:
- Slash command: `/quartermaster <subcommand> ...`
- CLI: `pi quartermaster <subcommand> ...`

## Goals
- Make Pi per-repo configuration easy and reproducible.
- Keep shared assets in a central local repo and link them into projects.
- Support grouping items into named sets to install together.
- Provide consistent behavior in both slash and CLI modes.

## Non-Goals (for initial version)
- Remote registries or Git URLs for shared repo (local path only).
- Version pinning (always use current files via symlink).
- Dependency resolution or auto-install of npm packages for extensions/tools.

## Terminology
- **Shared Repo**: Local filesystem folder containing canonical skills/extensions/tools/prompts and `quartermaster_sets.json`.
- **Local Repo**: The user’s current project repo where Pi runs.
- **Item**: One skill, extension, tool, or prompt template.
- **Set**: A named list of items to install together.

## Local Configuration
Stored in `.pi/quartermaster.json` in the current repo.

```json
{
  "repoPath": "/absolute/path/to/shared-repo",
  "setsFile": "quartermaster_sets.json"
}
```

- `repoPath` is required.
- `setsFile` defaults to `quartermaster_sets.json` if omitted.

When missing, Quartermaster prompts for `repoPath` (interactive UI). In non-interactive CLI mode, it should error with a hint to run `setup` or pass `--repo`.

## Shared Repo Layout
The shared repo contains items and a single sets file.

Recommended structure:
```
shared-repo/
├─ quartermaster_sets.json
├─ skills/
├─ extensions/
├─ tools/
└─ prompts/
```

### Item Discovery
- **Skills**: directories under `skills/` containing `SKILL.md`.
- **Extensions**: files or folders under `extensions/` matching Pi extension discovery rules.
- **Tools**: files or folders under `tools/` that are Pi extensions whose purpose is registering custom tools.
- **Prompts**: `*.md` files under `prompts/` (Pi prompt template format).

### Sets File (`quartermaster_sets.json`)
Defines named sets in the shared repo:

```json
{
  "version": 1,
  "sets": {
    "writer": {
      "description": "Writing helpers and idea generation",
      "items": {
        "skills": ["skills/writing-helper"],
        "extensions": ["extensions/spellcheck.ts"],
        "tools": ["tools/pr-comment.ts"],
        "prompts": ["prompts/blog/idea-generator.md"]
      }
    }
  }
}
```

- Item entries are **repo-relative paths** (portable across machines).
- Paths may point to files or directories depending on item type.

## Local Repo Layout (Install Targets)
Symlinks are created in the current repo:
```
.pi/
├─ skills/
├─ extensions/
├─ tools/
└─ prompts/
```

Rules:
- Install uses **symlinks** from shared repo to `.pi/<type>/...`.
- If the target exists and is not a symlink, abort with a clear error.
- If the target already links to the same source, treat as no-op.

## Commands
All commands are available via `/quartermaster` and `pi quartermaster` with identical behavior.

### `setup`
- Prompts for shared repo path (and optional `setsFile`).
- Writes `.pi/quartermaster.json`.
- Validates that `repoPath` exists and that `quartermaster_sets.json` is present (warning if missing).

### `list` (available items)
- Lists available items in the shared repo, grouped by type.
- Optional filter: `list <type>` where type is `skills|extensions|tools|prompts`.

### `installed`
- Lists currently installed items in the local repo (`.pi/`), grouped by type.

### `sets`
- Lists all sets defined in `quartermaster_sets.json` with item counts and description.

### `install`
Installs one item or a whole set.

Forms:
- `install <type> <path>`: installs a single item by shared-repo-relative path.
- `install set <name>`: installs all items in the named set.

Behavior:
- Creates target directories under `.pi/` if missing.
- Creates symlinks for each item.
- Accepts absolute or `~`-prefixed paths to install items outside the shared repo.
- External installs link from the given path into `.pi/<type>/<basename>`.
- Emits per-item result (linked, already linked, failed).

### `remove`
Removes locally installed symlinks only.

Forms:
- `remove <type> <path>`
- `remove set <name>`

Behavior:
- Removes symlink targets from `.pi/`.
- Does **not** modify shared repo contents.

### `add-to-set`
- Adds item(s) to a named set in `quartermaster_sets.json` (shared repo).
- Creates the set if it doesn’t exist.

Form:
- `add-to-set <set> <type> <path>`

### `remove-from-set`
- Removes item(s) from a named set in `quartermaster_sets.json`.

Form:
- `remove-from-set <set> <type> <path>`

## Argument Conventions
- `<type>` is one of `skills`, `extensions`, `tools`, `prompts`.
- `<path>` is the shared-repo-relative path used in `quartermaster_sets.json`.
- Paths are treated as exact matches; no globbing in v1.

## Behavior Notes
- If `repoPath` is not configured, Quartermaster prompts once and stores config.
- If `ctx.hasUI` is false (CLI non-interactive), require `--repo` or show a helpful error.
- Prompts are standard Pi prompt templates (Markdown with optional frontmatter).
- Tools are treated as extension modules focused on `registerTool` usage.

## Example Usage
```
/quartermaster setup
/quartermaster list
/quartermaster sets
/quartermaster install set writer
/quartermaster install prompts prompts/blog/idea-generator.md
/quartermaster remove tools tools/pr-comment.ts
/quartermaster installed
```

CLI equivalents:
```
pi quartermaster setup
pi quartermaster list
pi quartermaster install set writer
```

## Open Questions (Optional for v1)
- Should `install` support a dry-run mode?
- Should `list` show which items are already installed?
- Should `add-to-set` support multiple items in one call?

## Future Improvements
- Allow sets to reference external absolute paths (outside shared repo).
- Support multiple shared repos with priorities or namespaces.
- Add remote repo options (git URL, registry, or catalog).
- Add optional version pinning or lockfile for reproducible installs.
- Add `install --target` to customize local symlink names/paths.
