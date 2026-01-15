# Quartermaster Implementation Plan

1. Locate existing CLI/extension command scaffolding and add the `quartermaster` entry points.
2. Implement config loading/saving for `.pi/quartermaster.json` with repo path prompts.
3. Add shared repo discovery for items and sets parsing from `quartermaster_sets.json`.
4. Implement core commands: `list`, `installed`, `sets` with grouped output.
5. Implement install/remove flows for single items and sets with symlink handling.
6. Implement `add-to-set` and `remove-from-set` editing the shared sets file.
7. Add minimal validation/errors and update docs/examples if required.
