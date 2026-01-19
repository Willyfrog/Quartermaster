import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	DEFAULT_SETS_FILE,
	getQuartermasterConfigPath,
	getQuartermasterGlobalConfigPath,
	readQuartermasterConfig,
	resolveQuartermasterConfig,
	writeQuartermasterConfig,
} from "../src/quartermaster/config";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "quartermaster-"));
	try {
		await run(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
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

void test("readQuartermasterConfig returns null when config missing", async () => {
	await withTempDir(async (dir) => {
		const result = await readQuartermasterConfig(dir);
		assert.equal(result, null);
	});
});

void test("writeQuartermasterConfig persists normalized config", async () => {
	await withTempDir(async (dir) => {
		const sharedRepo = await fs.mkdtemp(path.join(dir, "shared-"));
		const written = await writeQuartermasterConfig({ repoPath: sharedRepo }, dir);
		assert.equal(written.repoPath, sharedRepo);
		assert.equal(written.setsFile, DEFAULT_SETS_FILE);

		const configPath = getQuartermasterConfigPath(dir);
		const stored = JSON.parse(await fs.readFile(configPath, "utf8")) as {
			repoPath: string;
			setsFile: string;
		};
		assert.equal(stored.repoPath, sharedRepo);
		assert.equal(stored.setsFile, DEFAULT_SETS_FILE);
	});
});

void test("writeQuartermasterConfig persists global config", async () => {
	await withTempAgentDir(async (_agentDir) => {
		await withTempDir(async (dir) => {
			const sharedRepo = await fs.mkdtemp(path.join(dir, "shared-"));
			const written = await writeQuartermasterConfig({ repoPath: sharedRepo }, dir, "global");
			assert.equal(written.repoPath, sharedRepo);
			const configPath = getQuartermasterGlobalConfigPath();
			const stored = JSON.parse(await fs.readFile(configPath, "utf8")) as {
				repoPath: string;
				setsFile: string;
			};
			assert.equal(stored.repoPath, sharedRepo);
			assert.equal(stored.setsFile, DEFAULT_SETS_FILE);
		});
	});
});

void test("writeQuartermasterConfig rejects non-directory repo path", async () => {
	await withTempDir(async (dir) => {
		const filePath = path.join(dir, "repo.txt");
		await fs.writeFile(filePath, "not a dir");
		await assert.rejects(() => writeQuartermasterConfig({ repoPath: filePath }, dir), /not a directory/u);
	});
});

void test("resolveQuartermasterConfig writes override with default sets file", async () => {
	await withTempDir(async (dir) => {
		const sharedRepo = await fs.mkdtemp(path.join(dir, "shared-"));
		const resolved = await resolveQuartermasterConfig({ cwd: dir, repoOverride: sharedRepo });
		assert.equal(resolved.repoPath, sharedRepo);
		assert.equal(resolved.setsFile, DEFAULT_SETS_FILE);

		const stored = await readQuartermasterConfig(dir);
		assert.equal(stored?.repoPath, sharedRepo);
	});
});

void test("resolveQuartermasterConfig falls back to global config", async () => {
	await withTempAgentDir(async () => {
		await withTempDir(async (dir) => {
			const sharedRepo = await fs.mkdtemp(path.join(dir, "shared-"));
			await writeQuartermasterConfig({ repoPath: sharedRepo }, dir, "global");

			const resolved = await resolveQuartermasterConfig({ cwd: dir });
			assert.equal(resolved.repoPath, sharedRepo);
			assert.equal(resolved.setsFile, DEFAULT_SETS_FILE);
		});
	});
});

void test("resolveQuartermasterConfig errors when repo path missing", async () => {
	await withTempDir(async (dir) => {
		const missingPath = path.join(dir, "missing-repo");
		const configPath = getQuartermasterConfigPath(dir);
		await fs.mkdir(path.dirname(configPath), { recursive: true });
		await fs.writeFile(
			configPath,
			JSON.stringify({ repoPath: missingPath, setsFile: DEFAULT_SETS_FILE }, null, 2),
			"utf8"
		);
		await assert.rejects(() => resolveQuartermasterConfig({ cwd: dir }), /does not exist/u);
	});
});

void test("resolveQuartermasterConfig prompts when config missing and UI available", async () => {
	await withTempAgentDir(async () => {
		await withTempDir(async (dir) => {
			const sharedRepo = await fs.mkdtemp(path.join(dir, "shared-"));
			const prompts: string[] = [];
			const resolved = await resolveQuartermasterConfig({
				cwd: dir,
				ctx: { hasUI: true },
				prompt: (message) => {
					prompts.push(message);
					return sharedRepo;
				},
			});
			assert.equal(prompts.length, 1);
			assert.equal(resolved.repoPath, sharedRepo);
			assert.equal(resolved.setsFile, DEFAULT_SETS_FILE);

			const stored = await readQuartermasterConfig(dir);
			assert.equal(stored?.repoPath, sharedRepo);
		});
	});
});

void test("resolveQuartermasterConfig errors without config in non-interactive mode", async () => {
	await withTempAgentDir(async () => {
		await withTempDir(async (dir) => {
			await assert.rejects(
				() => resolveQuartermasterConfig({ cwd: dir, ctx: { hasUI: false } }),
				/Run `\/quartermaster setup`/u
			);
		});
	});
});
