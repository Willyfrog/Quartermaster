import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveQuartermasterConfig } from "./config";
import type { QuartermasterConfigScope } from "./config";
import { discoverQuartermasterItems, readQuartermasterSets } from "./discovery";
import type {
	QuartermasterCommandContext,
	QuartermasterExecute,
	QuartermasterExecuteResult,
	QuartermasterParsedArgs,
} from "./entrypoints";
import type {
	QuartermasterDiscoveredItems,
	QuartermasterItemType,
	QuartermasterSetDefinition,
	QuartermasterSetItems,
	QuartermasterSets,
} from "./discovery";

const ITEM_TYPES: QuartermasterItemType[] = ["skills", "extensions", "tools", "prompts"];

type QuartermasterGroupedItems = Record<QuartermasterItemType, string[]>;

type QuartermasterCommandOutcome = {
	ok: boolean;
	message: string;
};

type QuartermasterItemResult = {
	status: string;
	item: string;
	detail?: string;
};

type QuartermasterResolvedInstall = {
	sourcePath: string;
	targetPath: string;
	displayPath: string;
};

type QuartermasterSetsFileInput = {
	version?: number;
	sets?: Record<
		string,
		{
			description?: string;
			items?: Partial<Record<QuartermasterItemType, string[]>>;
		}
	>;
};

type QuartermasterWritableSet = {
	description?: string;
	items: QuartermasterSetItems;
};

type QuartermasterWritableSets = {
	version: number;
	sets: Record<string, QuartermasterWritableSet>;
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

function normalizeInputPath(input: string): string {
	return input.replace(/\\/gu, "/").replace(/^\.\//u, "").trim();
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

function normalizeSetPath(type: QuartermasterItemType, input: string): string {
	const trimmed = input.trim();
	if (!trimmed) {
		throw new Error("Missing item path.");
	}
	if (isExternalPath(trimmed)) {
		throw new Error("Set items must be repo-relative paths.");
	}
	const normalized = normalizeInputPath(trimmed);
	const withoutPrefix = stripTypePrefix(type, normalized);
	if (!withoutPrefix) {
		throw new Error("Missing item path.");
	}
	return normalized.startsWith(`${type}/`) ? normalized : `${type}/${withoutPrefix}`;
}

function stripTypePrefix(type: QuartermasterItemType, input: string): string {
	const prefix = `${type}/`;
	if (input.startsWith(prefix)) {
		return input.slice(prefix.length);
	}
	return input;
}

function expandHomePath(input: string): string {
	if (!input.startsWith("~")) {
		return input;
	}

	if (input === "~") {
		return os.homedir();
	}

	const remainder = input.slice(1);
	const trimmed = remainder.startsWith(path.sep) ? remainder.slice(1) : remainder;
	return path.join(os.homedir(), trimmed);
}

function isExternalPath(input: string): boolean {
	return input.startsWith("~") || path.isAbsolute(input);
}

function emptyGroupedItems(): QuartermasterGroupedItems {
	return ITEM_TYPES.reduce((acc, type) => {
		acc[type] = [];
		return acc;
	}, {} as QuartermasterGroupedItems);
}

function groupDiscoveredItems(items: QuartermasterDiscoveredItems): QuartermasterGroupedItems {
	return ITEM_TYPES.reduce((acc, type) => {
		acc[type] = items[type].map((item) => stripTypePrefix(type, item.path));
		return acc;
	}, {} as QuartermasterGroupedItems);
}

function resolveInstallPaths(
	type: QuartermasterItemType,
	itemPath: string,
	repoPath: string,
	cwd: string
): QuartermasterResolvedInstall {
	const trimmed = itemPath.trim();
	if (!trimmed) {
		throw new Error("Missing item path.");
	}

	const expanded = expandHomePath(trimmed);
	const baseRoot = path.join(cwd, ".pi");

	if (isExternalPath(trimmed)) {
		const sourcePath = path.resolve(expanded);
		const targetPath = path.join(baseRoot, type, path.basename(sourcePath));
		const displayPath = normalizeRelativePath(baseRoot, targetPath);
		return { sourcePath, targetPath, displayPath };
	}

	const normalized = normalizeInputPath(trimmed);
	const withoutPrefix = stripTypePrefix(type, normalized);
	if (!withoutPrefix) {
		throw new Error("Missing item path.");
	}

	const sourceRelative = normalized.startsWith(`${type}/`)
		? normalized
		: `${type}/${withoutPrefix}`;
	const sourcePath = path.join(repoPath, ...sourceRelative.split("/"));
	const targetPath = path.join(baseRoot, type, ...withoutPrefix.split("/"));
	const displayPath = normalizeRelativePath(baseRoot, targetPath);
	return { sourcePath, targetPath, displayPath };
}

function resolveRemoveTarget(
	type: QuartermasterItemType,
	itemPath: string,
	cwd: string
): { targetPath: string; displayPath: string } {
	const trimmed = itemPath.trim();
	if (!trimmed) {
		throw new Error("Missing item path.");
	}

	const baseRoot = path.join(cwd, ".pi");
	if (isExternalPath(trimmed)) {
		const expanded = expandHomePath(trimmed);
		const targetPath = path.join(baseRoot, type, path.basename(expanded));
		const displayPath = normalizeRelativePath(baseRoot, targetPath);
		return { targetPath, displayPath };
	}

	const normalized = normalizeInputPath(trimmed);
	const withoutPrefix = stripTypePrefix(type, normalized);
	if (!withoutPrefix) {
		throw new Error("Missing item path.");
	}
	const targetPath = path.join(baseRoot, type, ...withoutPrefix.split("/"));
	const displayPath = normalizeRelativePath(baseRoot, targetPath);
	return { targetPath, displayPath };
}

function sortUnique(entries: string[]): string[] {
	return Array.from(new Set(entries)).sort((a, b) => a.localeCompare(b));
}

async function readSetsFileForWrite(
	repoPath: string,
	setsFile: string,
	options?: { allowMissing?: boolean }
): Promise<QuartermasterWritableSets | null> {
	const setsPath = path.join(repoPath, setsFile);
	try {
		const raw = await fs.readFile(setsPath, "utf8");
		const parsed = JSON.parse(raw) as QuartermasterSetsFileInput;
		const version = Number(parsed.version ?? 1);
		if (!Number.isFinite(version) || version <= 0) {
			throw new Error(`Quartermaster sets file has invalid version: ${version}`);
		}

		const entries = parsed.sets ?? {};
		const sets: Record<string, QuartermasterWritableSet> = {};
		for (const [name, entry] of Object.entries(entries)) {
			const trimmedName = name.trim();
			if (!trimmedName) {
				continue;
			}
			sets[trimmedName] = {
				description: entry.description?.trim() || undefined,
				items: normalizeSetItems(entry.items),
			};
		}

		return { version, sets };
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			return options?.allowMissing ? { version: 1, sets: {} } : null;
		}
		throw error;
	}
}

async function writeQuartermasterSetsFile(
	repoPath: string,
	setsFile: string,
	sets: QuartermasterWritableSets
): Promise<void> {
	const setsPath = path.join(repoPath, setsFile);
	const sortedSets = Object.fromEntries(
		Object.keys(sets.sets)
			.sort((a, b) => a.localeCompare(b))
			.map((name) => {
				const entry = sets.sets[name];
				const items = ITEM_TYPES.reduce<QuartermasterSetItems>((acc, type) => {
					acc[type] = sortUnique(entry.items[type]);
					return acc;
				}, {} as QuartermasterSetItems);
				return [name, { description: entry.description, items }];
			})
	);
	const payload = { version: sets.version, sets: sortedSets };
	await fs.writeFile(setsPath, JSON.stringify(payload, null, 2));
}

function flattenSetItems(set: QuartermasterSetDefinition): Array<{ type: QuartermasterItemType; path: string }> {
	const results: Array<{ type: QuartermasterItemType; path: string }> = [];
	for (const type of ITEM_TYPES) {
		for (const entry of set.items[type]) {
			results.push({ type, path: entry });
		}
	}
	return results;
}

async function linkItem(sourcePath: string, targetPath: string): Promise<{ status: string; detail?: string }> {
	try {
		await fs.stat(sourcePath);
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			return { status: "failed", detail: "source not found" };
		}
		throw error;
	}

	try {
		const stats = await fs.lstat(targetPath);
		if (!stats.isSymbolicLink()) {
			return { status: "failed", detail: "target exists and is not a symlink" };
		}
		const existing = await fs.readlink(targetPath);
		const resolvedExisting = path.resolve(path.dirname(targetPath), existing);
		const resolvedSource = path.resolve(sourcePath);
		if (resolvedExisting === resolvedSource) {
			return { status: "already linked" };
		}
		return { status: "failed", detail: "target already links elsewhere" };
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code !== "ENOENT") {
			throw error;
		}
	}

	await fs.mkdir(path.dirname(targetPath), { recursive: true });
	await fs.symlink(sourcePath, targetPath);
	return { status: "linked" };
}

async function removeItem(targetPath: string): Promise<{ status: string; detail?: string }> {
	try {
		const stats = await fs.lstat(targetPath);
		if (!stats.isSymbolicLink()) {
			return { status: "failed", detail: "target exists and is not a symlink" };
		}
		await fs.unlink(targetPath);
		return { status: "removed" };
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			return { status: "missing" };
		}
		throw error;
	}
}

function formatItemResults(header: string, results: QuartermasterItemResult[]): string {
	const lines = [header];
	for (const result of results) {
		const detail = result.detail ? `: ${result.detail}` : "";
		lines.push(`- ${result.status} ${result.item}${detail}`);
	}
	return lines.join("\n");
}

function formatItemDisplay(type: QuartermasterItemType, itemPath: string): string {
	return stripTypePrefix(type, itemPath);
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

function parseItemArgs(args: string[]): { type?: QuartermasterItemType; path?: string; error?: string } {
	if (args.length !== 2) {
		return { error: "Expected <type> <path>." };
	}
	const [candidate, itemPath] = args;
	if (!ITEM_TYPES.includes(candidate as QuartermasterItemType)) {
		return {
			error: `Unknown item type: ${candidate}. Expected one of ${ITEM_TYPES.join(", ")}.`,
		};
	}

	return { type: candidate as QuartermasterItemType, path: itemPath };
}

function parseSetArgs(args: string[]): { name?: string; error?: string } {
	if (args.length !== 2) {
		return { error: "Expected set <name>." };
	}
	const [keyword, name] = args;
	if (keyword !== "set") {
		return { error: "Expected set <name>." };
	}
	if (!name.trim()) {
		return { error: "Missing set name." };
	}
	return { name: name.trim() };
}

function parseSetItemArgs(
	args: string[]
): { name?: string; type?: QuartermasterItemType; path?: string; error?: string } {
	if (args.length !== 3) {
		return { error: "Expected <set> <type> <path>." };
	}
	const [name, candidate, itemPath] = args;
	if (!name.trim()) {
		return { error: "Missing set name." };
	}
	if (!ITEM_TYPES.includes(candidate as QuartermasterItemType)) {
		return {
			error: `Unknown item type: ${candidate}. Expected one of ${ITEM_TYPES.join(", ")}.`,
		};
	}
	return { name: name.trim(), type: candidate as QuartermasterItemType, path: itemPath };
}

function getPrompt(
	ctx?: QuartermasterCommandContext
): ((message: string) => Promise<string | undefined> | string | undefined) | undefined {
	if (!ctx) {
		return undefined;
	}
	if (ctx.prompt) {
		return ctx.prompt;
	}
	if (ctx.ui?.input) {
		return ctx.ui.input;
	}
	return undefined;
}

function getUsageMessage(): string {
	return [
		"Quartermaster commands:",
		"  setup [--global|--local] [repoPath] [setsFile]",
		"  list [type]",
		"  installed [type]",
		"  sets",
		"  install <type> <path>",
		"  install set <name>",
		"  remove <type> <path>",
		"  remove set <name>",
		"  add-to-set <set> <type> <path>",
		"  remove-from-set <set> <type> <path>",
	].join("\n");
}

async function handleList(parsed: QuartermasterParsedArgs, ctx?: QuartermasterCommandContext): Promise<QuartermasterCommandOutcome> {
	const { type, error } = parseTypeFilter(parsed.args);
	if (error) {
		return { ok: false, message: error };
	}

	const prompt = getPrompt(ctx);
	const config = await resolveQuartermasterConfig({ ctx, prompt });
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

	const prompt = getPrompt(ctx);
	const config = await resolveQuartermasterConfig({ ctx, prompt });
	const sets = await readQuartermasterSets(config.repoPath, config.setsFile);
	const setsPath = path.join(config.repoPath, config.setsFile);
	return { ok: true, message: formatSets(sets, setsPath) };
}

async function handleSetup(parsed: QuartermasterParsedArgs, ctx?: QuartermasterCommandContext): Promise<QuartermasterCommandOutcome> {
	const args = [...parsed.args];
	let scope: QuartermasterConfigScope = "local";

	while (args.length > 0 && args[0].startsWith("--")) {
		const flag = args.shift();
		if (flag === "--global") {
			scope = "global";
			continue;
		}
		if (flag === "--local") {
			scope = "local";
			continue;
		}
		return { ok: false, message: `Unknown option: ${flag}` };
	}

	if (args.length > 2) {
		return { ok: false, message: "Too many arguments provided." };
	}

	const [repoArg, setsFileArg] = args;
	let repoPath = repoArg?.trim();
	let setsFile = setsFileArg?.trim() || undefined;

	const prompt = getPrompt(ctx);
	if (!repoPath) {
		if (!ctx?.hasUI) {
			return {
				ok: false,
				message: "Quartermaster setup requires a repo path in non-interactive mode.",
			};
		}
		if (!prompt) {
			throw new Error("Interactive prompt unavailable for Quartermaster setup.");
		}
		repoPath = String(await prompt("Path to shared Quartermaster repo:"))?.trim();
		if (!repoPath) {
			return { ok: false, message: "Quartermaster repo path is required." };
		}
		if (!setsFile) {
			const response = await prompt(
				"Sets file name (optional, default quartermaster_sets.json):"
			);
			const candidate = String(response ?? "").trim();
			if (candidate) {
				setsFile = candidate;
			}
		}
	}

	const config = await resolveQuartermasterConfig({
		ctx,
		prompt,
		scope,
		repoOverride: repoPath,
		setsFileOverride: setsFile,
	});

	const setsPath = path.join(config.repoPath, config.setsFile);
	const lines = [`Quartermaster configured for ${config.repoPath}.`];
	if (!(await pathExists(setsPath))) {
		lines.push(`Warning: sets file not found at ${setsPath}.`);
	}
	return { ok: true, message: lines.join("\n") };
}

async function promptInstallArgs(
	ctx: QuartermasterCommandContext | undefined,
	prompt: ((message: string) => Promise<string | undefined> | string | undefined) | undefined
): Promise<{ args?: string[]; error?: string }> {
	if (!ctx?.hasUI) {
		return { error: "Expected install <type> <path> or install set <name>." };
	}
	if (!prompt) {
		return { error: "Interactive prompt unavailable for Quartermaster install." };
	}

	const typeInput = String(
		await prompt("Install type (skills/extensions/tools/prompts/set):")
	).trim();
	if (!typeInput) {
		return { error: "Install type is required." };
	}

	if (typeInput === "set") {
		const name = String(await prompt("Set name:"))?.trim();
		if (!name) {
			return { error: "Set name is required." };
		}
		return { args: ["set", name] };
	}

	if (!ITEM_TYPES.includes(typeInput as QuartermasterItemType)) {
		return {
			error: `Unknown item type: ${typeInput}. Expected one of ${ITEM_TYPES.join(", ")} or set.`,
		};
	}

	const itemPath = String(await prompt("Item path (relative to shared repo):"))?.trim();
	if (!itemPath) {
		return { error: "Item path is required." };
	}
	return { args: [typeInput, itemPath] };
}

async function handleInstall(
	parsed: QuartermasterParsedArgs,
	ctx?: QuartermasterCommandContext
): Promise<QuartermasterCommandOutcome> {
	let args = parsed.args;
	const prompt = getPrompt(ctx);

	if (args.length === 0) {
		const prompted = await promptInstallArgs(ctx, prompt);
		if (prompted.error) {
			return { ok: false, message: prompted.error };
		}
		args = prompted.args ?? [];
	}

	if (args.length === 0) {
		return { ok: false, message: "Expected install <type> <path> or install set <name>." };
	}

	const config = await resolveQuartermasterConfig({ ctx, prompt });
	const cwd = process.cwd();

	if (args[0] === "set") {
		const { name, error } = parseSetArgs(args);
		if (error) {
			return { ok: false, message: error };
		}

		const sets = await readQuartermasterSets(config.repoPath, config.setsFile);
		if (!sets) {
			const setsPath = path.join(config.repoPath, config.setsFile);
			return { ok: false, message: `No sets file found at ${setsPath}.` };
		}

		const targetSet = sets.sets.find((set) => set.name === name);
		if (!targetSet) {
			return { ok: false, message: `Unknown set: ${name}.` };
		}

		const results: QuartermasterItemResult[] = [];
		for (const entry of flattenSetItems(targetSet)) {
			try {
				const resolved = resolveInstallPaths(entry.type, entry.path, config.repoPath, cwd);
				const outcome = await linkItem(resolved.sourcePath, resolved.targetPath);
				results.push({
					status: outcome.status,
					item: formatItemDisplay(entry.type, resolved.displayPath),
					detail: outcome.detail,
				});
			} catch (error) {
				const err = error as Error;
				results.push({
					status: "failed",
					item: formatItemDisplay(entry.type, entry.path),
					detail: err.message,
				});
			}
		}

		return { ok: true, message: formatItemResults("Install results:", results) };
	}

	const { type, path: itemPath, error } = parseItemArgs(args);
	if (error || !type || !itemPath) {
		return { ok: false, message: error ?? "Invalid install arguments." };
	}

	const resolved = resolveInstallPaths(type, itemPath, config.repoPath, cwd);
	const outcome = await linkItem(resolved.sourcePath, resolved.targetPath);
	const results = [
		{
			status: outcome.status,
			item: formatItemDisplay(type, resolved.displayPath),
			detail: outcome.detail,
		},
	];
	return { ok: true, message: formatItemResults("Install results:", results) };
}

async function handleRemove(
	parsed: QuartermasterParsedArgs,
	ctx?: QuartermasterCommandContext
): Promise<QuartermasterCommandOutcome> {
	if (parsed.args.length === 0) {
		return { ok: false, message: "Expected remove <type> <path> or remove set <name>." };
	}

	const cwd = process.cwd();

	if (parsed.args[0] === "set") {
		const { name, error } = parseSetArgs(parsed.args);
		if (error) {
			return { ok: false, message: error };
		}

		const prompt = getPrompt(ctx);
		const config = await resolveQuartermasterConfig({ ctx, prompt });
		const sets = await readQuartermasterSets(config.repoPath, config.setsFile);
		if (!sets) {
			const setsPath = path.join(config.repoPath, config.setsFile);
			return { ok: false, message: `No sets file found at ${setsPath}.` };
		}

		const targetSet = sets.sets.find((set) => set.name === name);
		if (!targetSet) {
			return { ok: false, message: `Unknown set: ${name}.` };
		}

		const results: QuartermasterItemResult[] = [];
		for (const entry of flattenSetItems(targetSet)) {
			try {
				const resolved = resolveRemoveTarget(entry.type, entry.path, cwd);
				const outcome = await removeItem(resolved.targetPath);
				results.push({
					status: outcome.status,
					item: formatItemDisplay(entry.type, resolved.displayPath),
					detail: outcome.detail,
				});
			} catch (error) {
				const err = error as Error;
				results.push({
					status: "failed",
					item: formatItemDisplay(entry.type, entry.path),
					detail: err.message,
				});
			}
		}

		return { ok: true, message: formatItemResults("Remove results:", results) };
	}

	const { type, path: itemPath, error } = parseItemArgs(parsed.args);
	if (error || !type || !itemPath) {
		return { ok: false, message: error ?? "Invalid remove arguments." };
	}

	const resolved = resolveRemoveTarget(type, itemPath, cwd);
	const outcome = await removeItem(resolved.targetPath);
	const results = [
		{
			status: outcome.status,
			item: formatItemDisplay(type, resolved.displayPath),
			detail: outcome.detail,
		},
	];
	return { ok: true, message: formatItemResults("Remove results:", results) };
}

async function handleAddToSet(
	parsed: QuartermasterParsedArgs,
	ctx?: QuartermasterCommandContext
): Promise<QuartermasterCommandOutcome> {
	const { name, type, path: itemPath, error } = parseSetItemArgs(parsed.args);
	if (error || !name || !type || !itemPath) {
		return { ok: false, message: error ?? "Invalid add-to-set arguments." };
	}

	const prompt = getPrompt(ctx);
	const config = await resolveQuartermasterConfig({ ctx, prompt });
	const sets = await readSetsFileForWrite(config.repoPath, config.setsFile, { allowMissing: true });
	if (!sets) {
		const setsPath = path.join(config.repoPath, config.setsFile);
		return { ok: false, message: `No sets file found at ${setsPath}.` };
	}

	const normalizedPath = normalizeSetPath(type, itemPath);
	const targetSet = sets.sets[name] ?? { items: normalizeSetItems() };
	const existing = targetSet.items[type].includes(normalizedPath);
	if (!existing) {
		targetSet.items[type] = sortUnique([...targetSet.items[type], normalizedPath]);
	}

	sets.sets[name] = targetSet;
	await writeQuartermasterSetsFile(config.repoPath, config.setsFile, sets);

	const status = existing ? "already present" : "added";
	const results = [{ status, item: `${name} ${normalizedPath}` }];
	return { ok: true, message: formatItemResults("Set update results:", results) };
}

async function handleRemoveFromSet(
	parsed: QuartermasterParsedArgs,
	ctx?: QuartermasterCommandContext
): Promise<QuartermasterCommandOutcome> {
	const { name, type, path: itemPath, error } = parseSetItemArgs(parsed.args);
	if (error || !name || !type || !itemPath) {
		return { ok: false, message: error ?? "Invalid remove-from-set arguments." };
	}

	const prompt = getPrompt(ctx);
	const config = await resolveQuartermasterConfig({ ctx, prompt });
	const sets = await readSetsFileForWrite(config.repoPath, config.setsFile);
	if (!sets) {
		const setsPath = path.join(config.repoPath, config.setsFile);
		return { ok: false, message: `No sets file found at ${setsPath}.` };
	}

	const targetSet = sets.sets[name];
	if (!targetSet) {
		return { ok: false, message: `Unknown set: ${name}.` };
	}

	const normalizedPath = normalizeSetPath(type, itemPath);
	const existing = targetSet.items[type].includes(normalizedPath);
	if (existing) {
		targetSet.items[type] = targetSet.items[type].filter((entry) => entry !== normalizedPath);
	}

	sets.sets[name] = targetSet;
	await writeQuartermasterSetsFile(config.repoPath, config.setsFile, sets);

	const status = existing ? "removed" : "missing";
	const results = [{ status, item: `${name} ${normalizedPath}` }];
	return { ok: true, message: formatItemResults("Set update results:", results) };
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
			case "setup":
				return await handleSetup(parsed, context.ctx);
			case "install":
				return await handleInstall(parsed, context.ctx);
			case "remove":
				return await handleRemove(parsed, context.ctx);
			case "add-to-set":
				return await handleAddToSet(parsed, context.ctx);
			case "remove-from-set":
				return await handleRemoveFromSet(parsed, context.ctx);
			default:
				return { ok: false, message: getUsageMessage(), parsed };
		}
	} catch (error) {
		const err = error as Error;
		return { ok: false, message: err.message, parsed };
	}
};
