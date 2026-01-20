# Quartermaster

Quartermaster is a Pi extension command that manages repo-local skills, extensions, tools, and prompt templates by symlinking them from a shared local repository into the current repo’s `.pi/` folder.

It helps you:
- List available shared items by type
- Install/remove items via symlinks
- Install groups of items via sets

## Requirements

- [Pi coding agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)

> ⚠️ **Note:** There is a feature pending development upstream that may solve some of these problems differently in the future: https://github.com/badlogic/pi-mono/issues/645

## Install

Quartermaster is loaded as a Pi extension. The recommended setup is to install the **bundle globally** so it’s available in every Pi session.

### Global bundle install (recommended)

Download the release bundle into your global Pi extensions folder:

```bash
mkdir -p ~/.pi/agent/extensions
curl -L -o ~/.pi/agent/extensions/quartermaster.bundle.js \
  https://github.com/<org>/<repo>/releases/download/vX.Y.Z/quartermaster.bundle.js
```

Pi auto-discovers `.js` files in `~/.pi/agent/extensions`, so no extra configuration is needed.

Start Pi and run (interactive prompt):

```text
/quartermaster setup --global
```

Or pass the repo path (and optional sets file):

```text
/quartermaster setup --global /absolute/path/to/shared-repo quartermaster_sets.json
```

This stores the configuration in `~/.pi/agent/quartermaster.json` so it applies to every repo.

If you need per-repo settings, use `--local` to write `.pi/quartermaster.json` instead.

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

## Sets

Sets are named collections of skills, extensions, tools, and prompts that represent a reusable toolbox for a specific function or workflow (for example, “writer”, “frontend”, or “review”). Think of them as templates that aggregate the items you tend to install together.

Use sets when you want to:
- Install a bundle of related items with one command.
- Keep consistent tooling across repos or tasks.
- Capture a repeatable setup for a role or activity.

You can manage sets directly via commands:

```text
/quartermaster add-to-set writer skills skills/writing-helper
/quartermaster add-to-set writer prompts prompts/blog/idea-generator.md
/quartermaster remove-from-set writer prompts prompts/blog/idea-generator.md
/quartermaster install set writer
```

## Usage Examples

```text
/quartermaster setup --global
/quartermaster list
/quartermaster sets
/quartermaster install             # prompts for type/path
/quartermaster install set writer
/quartermaster install prompts prompts/blog/idea-generator.md
/quartermaster remove tools tools/pr-comment.ts
/quartermaster installed
```

## Quick Start

1. Create a shared repo that follows the layout below.
2. Install the global bundle in `~/.pi/agent/extensions`.
3. Run `/quartermaster setup --global` and enter your shared repo path (or pass it as an argument).
4. Use `/quartermaster list`, `/quartermaster install`, etc. to manage items.
