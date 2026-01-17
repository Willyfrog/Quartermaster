# Quartermaster

Quartermaster is a Pi extension + CLI command that manages repo-local skills, extensions, tools, and prompt templates by symlinking them from a shared local repository into the current repo’s `.pi/` folder.

## Requirements

- [Pi coding agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)

## Install

Quartermaster is loaded as a Pi extension. Since this repo is not packaged, point Pi at the extension entrypoint in `src/quartermaster/extension.ts`.

### Project-local install (recommended)

From your project repo:

```bash
mkdir -p .pi/extensions
ln -s /absolute/path/to/quartermaster/src/quartermaster/extension.ts .pi/extensions/quartermaster.ts
```

Start Pi and run:

```text
/quartermaster setup
```

### Global install

Add the extension path to your global Pi settings:

```json
// ~/.pi/agent/settings.json
{
  "extensions": ["/absolute/path/to/quartermaster/src/quartermaster/extension.ts"]
}
```

Or pass it on the command line:

```bash
pi --extension /absolute/path/to/quartermaster/src/quartermaster/extension.ts
```

## Shared Repo Layout

Quartermaster expects a shared local repo with a sets file and typed folders:

```
shared-repo/
├─ quartermaster_sets.json
├─ skills/
├─ extensions/
├─ tools/
└─ prompts/
```

Example `quartermaster_sets.json`:

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

## Usage (CLI)

Once installed, the command is available via Pi’s CLI as well:

```bash
pi quartermaster setup
pi quartermaster list
pi quartermaster install set writer
```

## Usage Examples

```text
/quartermaster setup
/quartermaster list
/quartermaster sets
/quartermaster install set writer
/quartermaster install prompts prompts/blog/idea-generator.md
/quartermaster remove tools tools/pr-comment.ts
/quartermaster installed
```

## Quick Start

1. Install the extension (project-local or global).
2. Run `/quartermaster setup` to point Quartermaster at your shared repo.
3. Use `/quartermaster list`, `/quartermaster install`, etc. to manage items.
