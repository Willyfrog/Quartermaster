import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readQuartermasterConfig, writeQuartermasterConfig } from "../src/quartermaster/config";
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

async function withTempAgentDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "quartermaster-agent-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		await run(dir);
	} finally {
		if (previous === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previous;
		}
		await fs.rm(dir, { recursive: true, force: true });
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
			return executeQuartermaster(parsed, {});
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Available items:/u);
		assert.match(result.message ?? "", /\bwriting-helper\b/u);
		assert.match(result.message ?? "", /\bspellcheck\.ts\b/u);
		assert.match(result.message ?? "", /\bpr-comment\.ts\b/u);
		assert.match(result.message ?? "", /\bblog\/idea\.md\b/u);
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
			return executeQuartermaster(parsed, {});
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
			return executeQuartermaster(parsed, {});
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Sets \(version 1\):/u);
		assert.match(result.message ?? "", /writer \(skills:1 extensions:0 tools:0 prompts:1\) - Writing helpers/u);
	} finally {
		await removeTempDir(shared);
		await removeTempDir(local);
	}
});

test("executeQuartermaster setup prompts for repo path", async () => {
	const shared = await createSharedRepo();
	const local = await createTempDir("quartermaster-local-");
	let promptCount = 0;

	try {
		const result = await withCwd(local, async () => {
			const parsed = parseQuartermasterArgs("setup");
			return executeQuartermaster(parsed, {
				source: "command",
				ctx: {
					hasUI: true,
					ui: {
						input: () => {
							promptCount += 1;
							return promptCount === 1 ? shared : "";
						},
						notify: () => {},
					},
				},
			});
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Quartermaster configured for/u);
		const config = await readQuartermasterConfig(local);
		assert.equal(config?.repoPath, shared);
		assert.equal(config?.setsFile, "quartermaster_sets.json");
	} finally {
		await removeTempDir(shared);
		await removeTempDir(local);
	}
});

test("executeQuartermaster setup accepts arguments", async () => {
	const shared = await createSharedRepo();
	const local = await createTempDir("quartermaster-local-");

	try {
		const result = await withCwd(local, async () => {
			const parsed = parseQuartermasterArgs(`setup ${shared} custom_sets.json`);
			return executeQuartermaster(parsed, {});
		});

		assert.equal(result.ok, true);
		const config = await readQuartermasterConfig(local);
		assert.equal(config?.repoPath, shared);
		assert.equal(config?.setsFile, "custom_sets.json");
	} finally {
		await removeTempDir(shared);
		await removeTempDir(local);
	}
});

test("executeQuartermaster setup writes global config", async () => {
	await withTempAgentDir(async () => {
		const shared = await createSharedRepo();
		const local = await createTempDir("quartermaster-local-");

		try {
			const result = await withCwd(local, async () => {
				const parsed = parseQuartermasterArgs(`setup --global ${shared}`);
				return executeQuartermaster(parsed, {});
			});

			assert.equal(result.ok, true);
			const config = await readQuartermasterConfig(local, "global");
			assert.equal(config?.repoPath, shared);
		} finally {
			await removeTempDir(shared);
			await removeTempDir(local);
		}
	});
});

test("executeQuartermaster setup errors without UI or args", async () => {
	const local = await createTempDir("quartermaster-local-");

	try {
		const result = await withCwd(local, async () => {
			const parsed = parseQuartermasterArgs("setup");
			return executeQuartermaster(parsed, {});
		});

		assert.equal(result.ok, false);
		assert.match(result.message ?? "", /requires a repo path/u);
	} finally {
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
			return executeQuartermaster(parsed, {});
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Install results:/u);
		assert.match(result.message ?? "", /linked writing-helper/u);

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

test("executeQuartermaster install prompts for args", async () => {
	const shared = await createSharedRepo();
	const local = await createTempDir("quartermaster-local-");
	let promptCount = 0;

	try {
		await writeQuartermasterConfig({ repoPath: shared, setsFile: "quartermaster_sets.json" }, local);

		const result = await withCwd(local, async () => {
			const parsed = parseQuartermasterArgs("install");
			return executeQuartermaster(parsed, {
				source: "command",
				ctx: {
					hasUI: true,
					ui: {
						input: () => {
							promptCount += 1;
							if (promptCount === 1) {
								return "skills";
							}
							return "writing-helper";
						},
						notify: () => {},
					},
				},
			});
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /linked writing-helper/u);
		const linkPath = path.join(local, ".pi", "skills", "writing-helper");
		const stats = await fs.lstat(linkPath);
		assert.equal(stats.isSymbolicLink(), true);
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
			return executeQuartermaster(parsed, {});
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Install results:/u);
		assert.match(result.message ?? "", /linked writing-helper/u);
		assert.match(result.message ?? "", /linked spellcheck\.ts/u);
		assert.match(result.message ?? "", /linked blog\/idea\.md/u);

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
			return executeQuartermaster(parsed, {});
		});

		assert.equal(result.ok, true);
		assert.match(result.message ?? "", /Remove results:/u);
		assert.match(result.message ?? "", /removed writing-helper/u);
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
			return executeQuartermaster(parsed, {});
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
			return executeQuartermaster(parsed, {});
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
