import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	discoverQuartermasterItems,
	readQuartermasterSets,
} from "../src/quartermaster/discovery";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "quartermaster-"));
	try {
		await run(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

async function writeFile(filePath: string, content = ""): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content, "utf8");
}

async function setupSharedRepo(root: string): Promise<void> {
	await writeFile(path.join(root, "skills", "alpha", "SKILL.md"), "# Alpha");
	await writeFile(path.join(root, "skills", "nested", "beta", "SKILL.md"), "# Beta");

	await writeFile(path.join(root, "extensions", "simple.ts"), "export default {};");
	await writeFile(path.join(root, "extensions", "folder", "index.ts"), "export default {};");
	await writeFile(
		path.join(root, "extensions", "pack", "package.json"),
		JSON.stringify({ name: "pack", pi: { extensions: ["./index.ts"] } }, null, 2)
	);

	await writeFile(path.join(root, "tools", "tool.ts"), "export default {};");
	await writeFile(path.join(root, "tools", "dir", "index.js"), "module.exports = {};");
	await writeFile(
		path.join(root, "tools", "tool-pack", "package.json"),
		JSON.stringify({ name: "tool-pack", pi: { extensions: ["./tool.ts"] } }, null, 2)
	);

	await writeFile(path.join(root, "prompts", "welcome.md"), "Hello");
	await writeFile(path.join(root, "prompts", "nested", "guide.md"), "Guide");
}

test("discoverQuartermasterItems finds shared repo items", async () => {
	await withTempDir(async (dir) => {
		await setupSharedRepo(dir);

		const items = await discoverQuartermasterItems(dir);

		assert.deepEqual(
			items.skills.map((item) => item.path),
			["skills/alpha", "skills/nested/beta"]
		);
		assert.deepEqual(
			items.extensions.map((item) => item.path),
			["extensions/folder", "extensions/pack", "extensions/simple.ts"]
		);
		assert.deepEqual(
			items.tools.map((item) => item.path),
			["tools/dir", "tools/tool-pack", "tools/tool.ts"]
		);
		assert.deepEqual(
			items.prompts.map((item) => item.path),
			["prompts/nested/guide.md", "prompts/welcome.md"]
		);
	});
});

test("readQuartermasterSets parses sets file and normalizes items", async () => {
	await withTempDir(async (dir) => {
		await writeFile(
			path.join(dir, "quartermaster_sets.json"),
			JSON.stringify(
				{
					version: 1,
					sets: {
						writer: {
							description: " Writing helpers ",
							items: {
								skills: ["skills/writing"],
								extensions: ["extensions/spellcheck.ts"],
							},
						},
					},
				},
				null,
				2
			)
		);

		const sets = await readQuartermasterSets(dir, "quartermaster_sets.json");
		if (!sets) {
			throw new Error("Expected sets to be defined");
		}
		assert.equal(sets.version, 1);
		assert.equal(sets.sets.length, 1);
		assert.equal(sets.sets[0].name, "writer");
		assert.equal(sets.sets[0].description, "Writing helpers");
		assert.deepEqual(sets.sets[0].items.skills, ["skills/writing"]);
		assert.deepEqual(sets.sets[0].items.extensions, ["extensions/spellcheck.ts"]);
		assert.deepEqual(sets.sets[0].items.tools, []);
		assert.deepEqual(sets.sets[0].items.prompts, []);
	});
});


test("readQuartermasterSets returns null when sets file missing", async () => {
	await withTempDir(async (dir) => {
		const sets = await readQuartermasterSets(dir, "quartermaster_sets.json");
		assert.equal(sets, null);
	});
});
