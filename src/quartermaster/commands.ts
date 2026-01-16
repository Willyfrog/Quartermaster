import fs from "node:fs/promises";
import path from "node:path";
import { resolveQuartermasterConfig } from "./config";
import { discoverQuartermasterItems, readQuartermasterSets } from "./discovery";
import type {
	QuartermasterCommandContext,
	QuartermasterExecute,
	QuartermasterExecuteResult,
	QuartermasterParsedArgs,
} from "./entrypoints";
import type { QuartermasterDiscoveredItems, QuartermasterItemType, QuartermasterSets } from "./discovery";

const ITEM_TYPES: QuartermasterItemType[] = ["skills", "extensions", "tools", "prompts"];

type QuartermasterGroupedItems = Record<QuartermasterItemType, string[]>;

type QuartermasterCommandOutcome = {
	ok: boolean;
	message: string;
};

async function pathExists(targetPath: string): Promise<boolean> {
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

function emptyGroupedItems(): QuartermasterGroupedItems {
	return ITEM_TYPES.reduce((acc, type) => {
		acc[type] = [];
		return acc;
	}, {} as QuartermasterGroupedItems);
}

function groupDiscoveredItems(items: QuartermasterDiscoveredItems): QuartermasterGroupedItems {
	return ITEM_TYPES.reduce((acc, type) => {
		acc[type] = items[type].map((item) => item.path);
		return acc;
	}, {} as QuartermasterGroupedItems);
}

async function collectSymlinkEntries(root: string, baseRoot: string): Promise<string[]> {
	if (!(await pathExists(root))) {
		return [];
	}

	const entries = await fs.readdir(root, { withFileTypes: true });
	const results: string[] = [];

	for (const entry of entries) {
		const entryPath = path.join(root, entry.name);
		const stats = await fs.lstat(entryPath);

		if (stats.isSymbolicLink()) {
			results.push(normalizeRelativePath(baseRoot, entryPath));
			continue;
		}

		if (stats.isDirectory()) {
			results.push(...(await collectSymlinkEntries(entryPath, baseRoot)));
		}
	}

	return results;
}

async function readInstalledItems(cwd: string): Promise<QuartermasterGroupedItems> {
	const baseRoot = path.join(cwd, ".pi");
	if (!(await pathExists(baseRoot))) {
		return emptyGroupedItems();
	}

	const grouped: QuartermasterGroupedItems = emptyGroupedItems();

	for (const type of ITEM_TYPES) {
		const root = path.join(baseRoot, type);
		const entries = await collectSymlinkEntries(root, baseRoot);
		grouped[type] = entries.sort((a, b) => a.localeCompare(b));
	}

	return grouped;
}

function formatGroupedItems(
	header: string,
	items: QuartermasterGroupedItems,
	types: QuartermasterItemType[]
): string {
	const lines = [header];

	for (const type of types) {
		lines.push(`${type}:`);
		const entries = items[type];
		if (!entries || entries.length === 0) {
			lines.push("  (none)");
			continue;
		}
		for (const entry of entries) {
			lines.push(`  - ${entry}`);
		}
	}

	return lines.join("\n");
}

function formatSets(sets: QuartermasterSets | null, setsPath: string): string {
	if (!sets) {
		return `No sets file found at ${setsPath}.`;
	}

	if (sets.sets.length === 0) {
		return `No sets defined in ${setsPath}.`;
	}

	const lines = [`Sets (version ${sets.version}):`];

	for (const set of sets.sets) {
		const counts = ITEM_TYPES.map((type) => `${type}:${set.items[type].length}`).join(" ");
		const description = set.description ? ` - ${set.description}` : "";
		lines.push(`- ${set.name} (${counts})${description}`);
	}

	return lines.join("\n");
}

function parseTypeFilter(args: string[]): { type?: QuartermasterItemType; error?: string } {
	if (args.length === 0) {
		return {};
	}

	const [candidate, ...rest] = args;
	if (rest.length > 0) {
		return { error: "Too many arguments provided." };
	}

	if (!ITEM_TYPES.includes(candidate as QuartermasterItemType)) {
		return {
			error: `Unknown item type: ${candidate}. Expected one of ${ITEM_TYPES.join(", ")}.`,
		};
	}

	return { type: candidate as QuartermasterItemType };
}

function getUsageMessage(): string {
	return [
		"Quartermaster commands:",
		"  list [type]",
		"  installed [type]",
		"  sets",
	].join("\n");
}

async function handleList(parsed: QuartermasterParsedArgs, ctx?: QuartermasterCommandContext): Promise<QuartermasterCommandOutcome> {
	const { type, error } = parseTypeFilter(parsed.args);
	if (error) {
		return { ok: false, message: error };
	}

	const config = await resolveQuartermasterConfig({ ctx, prompt: ctx?.prompt });
	const items = await discoverQuartermasterItems(config.repoPath);
	const grouped = groupDiscoveredItems(items);
	const types = type ? [type] : ITEM_TYPES;
	return { ok: true, message: formatGroupedItems("Available items:", grouped, types) };
}

async function handleInstalled(parsed: QuartermasterParsedArgs): Promise<QuartermasterCommandOutcome> {
	const { type, error } = parseTypeFilter(parsed.args);
	if (error) {
		return { ok: false, message: error };
	}

	const grouped = await readInstalledItems(process.cwd());
	const types = type ? [type] : ITEM_TYPES;
	return { ok: true, message: formatGroupedItems("Installed items:", grouped, types) };
}

async function handleSets(parsed: QuartermasterParsedArgs, ctx?: QuartermasterCommandContext): Promise<QuartermasterCommandOutcome> {
	if (parsed.args.length > 0) {
		return { ok: false, message: "Too many arguments provided." };
	}

	const config = await resolveQuartermasterConfig({ ctx, prompt: ctx?.prompt });
	const sets = await readQuartermasterSets(config.repoPath, config.setsFile);
	const setsPath = path.join(config.repoPath, config.setsFile);
	return { ok: true, message: formatSets(sets, setsPath) };
}

export const executeQuartermaster: QuartermasterExecute = async (
	parsed: QuartermasterParsedArgs,
	context
): Promise<QuartermasterExecuteResult> => {
	try {
		switch (parsed.subcommand) {
			case "list":
				return await handleList(parsed, context.ctx);
			case "installed":
				return await handleInstalled(parsed);
			case "sets":
				return await handleSets(parsed, context.ctx);
			default:
				return { ok: false, message: getUsageMessage(), parsed };
		}
	} catch (error) {
		const err = error as Error;
		return { ok: false, message: err.message, parsed };
	}
};
