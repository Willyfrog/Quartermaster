import fs from "node:fs/promises";
import path from "node:path";

const ITEM_TYPES = ["skills", "extensions", "tools", "prompts"] as const;

type QuartermasterItemType = (typeof ITEM_TYPES)[number];

type QuartermasterDiscoveredItem = {
	path: string;
	absolutePath: string;
	type: QuartermasterItemType;
};

type QuartermasterDiscoveredItems = Record<QuartermasterItemType, QuartermasterDiscoveredItem[]>;

type QuartermasterSetItems = Record<QuartermasterItemType, string[]>;

type QuartermasterSetDefinition = {
	name: string;
	description?: string;
	items: QuartermasterSetItems;
};

type QuartermasterSets = {
	version: number;
	sets: QuartermasterSetDefinition[];
};

type QuartermasterSetInput = {
	description?: string;
	items?: Partial<Record<QuartermasterItemType, string[]>>;
};

type QuartermasterSetsInput = {
	version?: number;
	sets?: Record<string, QuartermasterSetInput>;
};

async function fileExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

function normalizeRelativePath(basePath: string, targetPath: string): string {
	const relative = path.relative(basePath, targetPath);
	return relative.split(path.sep).join("/");
}

async function findSkillDirs(skillsRoot: string): Promise<string[]> {
	if (!(await fileExists(skillsRoot))) {
		return [];
	}

	const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
	const results: string[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const candidate = path.join(skillsRoot, entry.name);
		if (await fileExists(path.join(candidate, "SKILL.md"))) {
			results.push(candidate);
			continue;
		}
		results.push(...(await findSkillDirs(candidate)));
	}

	return results;
}

async function findPromptFiles(promptsRoot: string): Promise<string[]> {
	if (!(await fileExists(promptsRoot))) {
		return [];
	}

	const entries = await fs.readdir(promptsRoot, { withFileTypes: true });
	const results: string[] = [];

	for (const entry of entries) {
		const candidate = path.join(promptsRoot, entry.name);
		if (entry.isDirectory()) {
			results.push(...(await findPromptFiles(candidate)));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".md")) {
			results.push(candidate);
		}
	}

	return results;
}

async function discoverExtensions(root: string): Promise<string[]> {
	if (!(await fileExists(root))) {
		return [];
	}

	const entries = await fs.readdir(root, { withFileTypes: true });
	const results: string[] = [];

	for (const entry of entries) {
		const candidate = path.join(root, entry.name);
		if (entry.isFile()) {
			if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
				results.push(candidate);
			}
			continue;
		}

		if (!entry.isDirectory()) {
			continue;
		}

		const hasIndex =
			(await fileExists(path.join(candidate, "index.ts"))) ||
			(await fileExists(path.join(candidate, "index.js")));

		if (hasIndex) {
			results.push(candidate);
			continue;
		}

		const packageJsonPath = path.join(candidate, "package.json");
		if (!(await fileExists(packageJsonPath))) {
			continue;
		}

		const raw = await fs.readFile(packageJsonPath, "utf8");
		const parsed = JSON.parse(raw) as { pi?: unknown };
		if (parsed.pi) {
			results.push(candidate);
		}
	}

	return results;
}

function normalizeSetItems(items?: Partial<Record<QuartermasterItemType, string[]>>): QuartermasterSetItems {
	return ITEM_TYPES.reduce<QuartermasterSetItems>((acc, type) => {
		const entries = items?.[type] ?? [];
		acc[type] = entries
			.map((entry) => String(entry).trim())
			.filter((entry) => entry.length > 0);
		return acc;
	}, {} as QuartermasterSetItems);
}

function normalizeSetDefinition(name: string, entry: QuartermasterSetInput | undefined): QuartermasterSetDefinition {
	return {
		name,
		description: entry?.description?.trim() || undefined,
		items: normalizeSetItems(entry?.items),
	};
}

export async function discoverQuartermasterItems(repoPath: string): Promise<QuartermasterDiscoveredItems> {
	const skillsRoot = path.join(repoPath, "skills");
	const extensionsRoot = path.join(repoPath, "extensions");
	const toolsRoot = path.join(repoPath, "tools");
	const promptsRoot = path.join(repoPath, "prompts");

	const [skills, extensions, tools, prompts] = await Promise.all([
		findSkillDirs(skillsRoot),
		discoverExtensions(extensionsRoot),
		discoverExtensions(toolsRoot),
		findPromptFiles(promptsRoot),
	]);

	const items: QuartermasterDiscoveredItems = {
		skills: skills
			.map((absolutePath) => ({
				path: normalizeRelativePath(repoPath, absolutePath),
				absolutePath,
				type: "skills" as const,
			}))
			.sort((a, b) => a.path.localeCompare(b.path)),
		extensions: extensions
			.map((absolutePath) => ({
				path: normalizeRelativePath(repoPath, absolutePath),
				absolutePath,
				type: "extensions" as const,
			}))
			.sort((a, b) => a.path.localeCompare(b.path)),
		tools: tools
			.map((absolutePath) => ({
				path: normalizeRelativePath(repoPath, absolutePath),
				absolutePath,
				type: "tools" as const,
			}))
			.sort((a, b) => a.path.localeCompare(b.path)),
		prompts: prompts
			.map((absolutePath) => ({
				path: normalizeRelativePath(repoPath, absolutePath),
				absolutePath,
				type: "prompts" as const,
			}))
			.sort((a, b) => a.path.localeCompare(b.path)),
	};

	return items;
}

export async function readQuartermasterSets(
	repoPath: string,
	setsFile: string
): Promise<QuartermasterSets | null> {
	const setsPath = path.join(repoPath, setsFile);
	try {
		const raw = await fs.readFile(setsPath, "utf8");
		const parsed = JSON.parse(raw) as QuartermasterSetsInput;
		const version = Number(parsed.version ?? 0);
		if (!Number.isFinite(version) || version <= 0) {
			throw new Error(`Quartermaster sets file has invalid version: ${version}`);
		}
		const entries = parsed.sets ?? {};
		const sets = Object.entries(entries)
			.map(([name, entry]) => normalizeSetDefinition(name, entry))
			.sort((a, b) => a.name.localeCompare(b.name));
		return { version, sets };
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

export type {
	QuartermasterDiscoveredItem,
	QuartermasterDiscoveredItems,
	QuartermasterItemType,
	QuartermasterSetDefinition,
	QuartermasterSetItems,
	QuartermasterSets,
};
