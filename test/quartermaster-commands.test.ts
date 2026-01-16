import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeQuartermasterConfig } from "../src/quartermaster/config";
import { executeQuartermaster } from "../src/quartermaster/commands";
import { parseQuartermasterArgs } from "../src/quartermaster/entrypoints";

async function createTempDir(prefix: string): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function removeTempDir(dir: string): Promise<void> {
	await fs.rm(dir, { recursive: true, force: true });
}

async function withCwd<T>(cwd: string, run: () => Promise<T>): Promise<T> {
	const previous = process.cwd();
	process.chdir(cwd);
	try {
		return await run();
	} finally {
		process.chdir(previous);
	}
}

async function createSharedRepo(): Promise<string> {
	const shared = await createTempDir("quartermaster-shared-");
	await fs.mkdir(path.join(shared, "skills", "writing-helper"), { recursive: true });
	await fs.writeFile(path.join(shared, "skills", "writing-helper", "SKILL.md"), "Skill");
	await fs.mkdir(path.join(shared, "extensions"), { recursive: true });
	await fs.writeFile(path.join(shared, "extensions", "spellcheck.ts"), "export {};\n");
	await fs.mkdir(path.join(shared, "tools"), { recursive: true });
	await fs.writeFile(path.join(shared, "tools", "pr-comment.ts"), "export {};\n");
	await fs.mkdir(path.join(shared, "prompts", "blog"), { recursive: true });
	await fs.writeFile(path.join(shared, "prompts", "blog", "idea.md"), "# Idea\n");
	return shared;
}

test("executeQuartermaster list outputs grouped items", async () => {
	const shared = await createSharedRepo();
	const local = await createTempDir("quartermaster-local-");

	try {
		await writeQuartermasterConfig({ repoPath: shared, setsFile: "quartermaster_sets.json" }, local);

		const result = await withCwd(local, async () => {
			const parsed = parseQuartermasterArgs("list");
			return executeQuartermaster(parsed, { source: "cli" });
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Available items:/u);
		assert.match(result.message ?? "", /skills\/writing-helper/u);
		assert.match(result.message ?? "", /extensions\/spellcheck\.ts/u);
		assert.match(result.message ?? "", /tools\/pr-comment\.ts/u);
		assert.match(result.message ?? "", /prompts\/blog\/idea\.md/u);
	} finally {
		await removeTempDir(shared);
		await removeTempDir(local);
	}
});

test("executeQuartermaster installed reports symlinked items", async () => {
	const shared = await createSharedRepo();
	const local = await createTempDir("quartermaster-local-");

	try {
		const skillsDir = path.join(local, ".pi", "skills");
		await fs.mkdir(skillsDir, { recursive: true });
		await fs.symlink(path.join(shared, "skills", "writing-helper"), path.join(skillsDir, "writing-helper"));

		const result = await withCwd(local, async () => {
			const parsed = parseQuartermasterArgs("installed");
			return executeQuartermaster(parsed, { source: "cli" });
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Installed items:/u);
		assert.match(result.message ?? "", /skills\/writing-helper/u);
	} finally {
		await removeTempDir(shared);
		await removeTempDir(local);
	}
});

test("executeQuartermaster sets lists set counts", async () => {
	const shared = await createSharedRepo();
	const local = await createTempDir("quartermaster-local-");

	try {
		await fs.writeFile(
			path.join(shared, "quartermaster_sets.json"),
			JSON.stringify(
				{
					version: 1,
					sets: {
						writer: {
							description: "Writing helpers",
							items: {
								skills: ["skills/writing-helper"],
								prompts: ["prompts/blog/idea.md"],
							},
						},
					},
				},
				null,
				2
			)
		);
		await writeQuartermasterConfig({ repoPath: shared, setsFile: "quartermaster_sets.json" }, local);

		const result = await withCwd(local, async () => {
			const parsed = parseQuartermasterArgs("sets");
			return executeQuartermaster(parsed, { source: "cli" });
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Sets \(version 1\):/u);
		assert.match(result.message ?? "", /writer \(skills:1 extensions:0 tools:0 prompts:1\) - Writing helpers/u);
	} finally {
		await removeTempDir(shared);
		await removeTempDir(local);
	}
});
