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

async function writeSharedSets(shared: string): Promise<void> {
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
							extensions: ["extensions/spellcheck.ts"],
							prompts: ["prompts/blog/idea.md"],
						},
					},
				},
			},
			null,
			2
		)
	);
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

test("executeQuartermaster install links a single item", async () => {
	const shared = await createSharedRepo();
	const local = await createTempDir("quartermaster-local-");

	try {
		await writeQuartermasterConfig({ repoPath: shared, setsFile: "quartermaster_sets.json" }, local);

		const result = await withCwd(local, async () => {
			const parsed = parseQuartermasterArgs("install skills skills/writing-helper");
			return executeQuartermaster(parsed, { source: "cli" });
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Install results:/u);
		assert.match(result.message ?? "", /linked skills\/writing-helper/u);

		const linkPath = path.join(local, ".pi", "skills", "writing-helper");
		const stats = await fs.lstat(linkPath);
		assert.equal(stats.isSymbolicLink(), true);
		const linkTarget = await fs.readlink(linkPath);
		const resolved = path.resolve(path.dirname(linkPath), linkTarget);
		assert.equal(resolved, path.join(shared, "skills", "writing-helper"));
	} finally {
		await removeTempDir(shared);
		await removeTempDir(local);
	}
});

test("executeQuartermaster install set links all items", async () => {
	const shared = await createSharedRepo();
	const local = await createTempDir("quartermaster-local-");

	try {
		await writeSharedSets(shared);
		await writeQuartermasterConfig({ repoPath: shared, setsFile: "quartermaster_sets.json" }, local);

		const result = await withCwd(local, async () => {
			const parsed = parseQuartermasterArgs("install set writer");
			return executeQuartermaster(parsed, { source: "cli" });
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Install results:/u);
		assert.match(result.message ?? "", /linked skills\/writing-helper/u);
		assert.match(result.message ?? "", /linked extensions\/spellcheck\.ts/u);
		assert.match(result.message ?? "", /linked prompts\/blog\/idea\.md/u);

		const skillLink = path.join(local, ".pi", "skills", "writing-helper");
		const extensionLink = path.join(local, ".pi", "extensions", "spellcheck.ts");
		const promptLink = path.join(local, ".pi", "prompts", "blog", "idea.md");
		assert.equal((await fs.lstat(skillLink)).isSymbolicLink(), true);
		assert.equal((await fs.lstat(extensionLink)).isSymbolicLink(), true);
		assert.equal((await fs.lstat(promptLink)).isSymbolicLink(), true);
	} finally {
		await removeTempDir(shared);
		await removeTempDir(local);
	}
});

test("executeQuartermaster remove removes symlinked items", async () => {
	const shared = await createSharedRepo();
	const local = await createTempDir("quartermaster-local-");

	try {
		const skillsDir = path.join(local, ".pi", "skills");
		await fs.mkdir(skillsDir, { recursive: true });
		await fs.symlink(path.join(shared, "skills", "writing-helper"), path.join(skillsDir, "writing-helper"));

		const result = await withCwd(local, async () => {
			const parsed = parseQuartermasterArgs("remove skills skills/writing-helper");
			return executeQuartermaster(parsed, { source: "cli" });
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Remove results:/u);
		assert.match(result.message ?? "", /removed skills\/writing-helper/u);
		await assert.rejects(() => fs.lstat(path.join(skillsDir, "writing-helper")));
	} finally {
		await removeTempDir(shared);
		await removeTempDir(local);
	}
});

test("executeQuartermaster add-to-set writes shared sets file", async () => {
	const shared = await createSharedRepo();
	const local = await createTempDir("quartermaster-local-");

	try {
		await writeQuartermasterConfig({ repoPath: shared, setsFile: "quartermaster_sets.json" }, local);

		const result = await withCwd(local, async () => {
			const parsed = parseQuartermasterArgs("add-to-set writer skills skills/writing-helper");
			return executeQuartermaster(parsed, { source: "cli" });
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Set update results:/u);
		assert.match(result.message ?? "", /added writer skills\/writing-helper/u);

		const raw = JSON.parse(await fs.readFile(path.join(shared, "quartermaster_sets.json"), "utf8")) as {
			version: number;
			sets: Record<string, { items: Record<string, string[]> }>;
		};
		assert.equal(raw.version, 1);
		assert.deepEqual(raw.sets.writer.items.skills, ["skills/writing-helper"]);
		assert.deepEqual(raw.sets.writer.items.extensions, []);
		assert.deepEqual(raw.sets.writer.items.tools, []);
		assert.deepEqual(raw.sets.writer.items.prompts, []);
	} finally {
		await removeTempDir(shared);
		await removeTempDir(local);
	}
});

test("executeQuartermaster remove-from-set updates shared sets file", async () => {
	const shared = await createSharedRepo();
	const local = await createTempDir("quartermaster-local-");

	try {
		await writeSharedSets(shared);
		await writeQuartermasterConfig({ repoPath: shared, setsFile: "quartermaster_sets.json" }, local);

		const result = await withCwd(local, async () => {
			const parsed = parseQuartermasterArgs("remove-from-set writer skills skills/writing-helper");
			return executeQuartermaster(parsed, { source: "cli" });
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Set update results:/u);
		assert.match(result.message ?? "", /removed writer skills\/writing-helper/u);

		const raw = JSON.parse(await fs.readFile(path.join(shared, "quartermaster_sets.json"), "utf8")) as {
			version: number;
			sets: Record<string, { items: Record<string, string[]> }>;
		};
		assert.deepEqual(raw.sets.writer.items.skills, []);
		assert.deepEqual(raw.sets.writer.items.extensions, ["extensions/spellcheck.ts"]);
		assert.deepEqual(raw.sets.writer.items.prompts, ["prompts/blog/idea.md"]);
	} finally {
		await removeTempDir(shared);
		await removeTempDir(local);
	}
});
