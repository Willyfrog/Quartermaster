import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_SETS_FILE = "quartermaster_sets.json";
const CONFIG_FILENAME = "quartermaster.json";

type QuartermasterConfig = {
	repoPath: string;
	setsFile: string;
};

type QuartermasterConfigInput = {
	repoPath: string;
	setsFile?: string;
};

type QuartermasterConfigPrompt = (message: string) => Promise<string> | string;

type QuartermasterConfigContext = {
	hasUI?: boolean;
};

type QuartermasterConfigResolveOptions = {
	cwd?: string;
	repoOverride?: string;
	setsFileOverride?: string;
	scope?: QuartermasterConfigScope;
	ctx?: QuartermasterConfigContext;
	prompt?: QuartermasterConfigPrompt;
};

type QuartermasterConfigScope = "local" | "global" | "auto";

function normalizeConfig(config: QuartermasterConfigInput): QuartermasterConfig {
	const repoPath = config.repoPath.trim();
	if (!repoPath) {
		throw new Error("Quartermaster repo path is required.");
	}

	return {
		repoPath,
		setsFile: config.setsFile?.trim() || DEFAULT_SETS_FILE,
	};
}

async function validateRepoPath(repoPath: string): Promise<void> {
	try {
		const stats = await fs.stat(repoPath);
		if (!stats.isDirectory()) {
			throw new Error(`Quartermaster repo path is not a directory: ${repoPath}`);
		}
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			throw new Error(`Quartermaster repo path does not exist: ${repoPath}`);
		}
		throw error;
	}
}

export function getQuartermasterConfigPath(cwd: string = process.cwd()): string {
	return path.join(cwd, ".pi", CONFIG_FILENAME);
}

export function getQuartermasterGlobalConfigPath(): string {
	const baseDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
	return path.join(baseDir, CONFIG_FILENAME);
}

async function readConfigAtPath(configPath: string): Promise<QuartermasterConfig | null> {
	try {
		const raw = await fs.readFile(configPath, "utf8");
		const parsed = JSON.parse(raw) as QuartermasterConfigInput;
		return normalizeConfig(parsed);
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

export async function readQuartermasterConfig(
	cwd: string = process.cwd(),
	scope: QuartermasterConfigScope = "local"
): Promise<QuartermasterConfig | null> {
	if (scope === "global") {
		return readConfigAtPath(getQuartermasterGlobalConfigPath());
	}

	const local = await readConfigAtPath(getQuartermasterConfigPath(cwd));
	if (scope === "auto" && !local) {
		return readConfigAtPath(getQuartermasterGlobalConfigPath());
	}
	return local;
}

export async function writeQuartermasterConfig(
	config: QuartermasterConfigInput,
	cwd: string = process.cwd(),
	scope: QuartermasterConfigScope = "local"
): Promise<QuartermasterConfig> {
	const normalized = normalizeConfig(config);
	await validateRepoPath(normalized.repoPath);
	const configPath =
		scope === "global" ? getQuartermasterGlobalConfigPath() : getQuartermasterConfigPath(cwd);
	await fs.mkdir(path.dirname(configPath), { recursive: true });
	await fs.writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
	return normalized;
}

export async function resolveQuartermasterConfig(
	options: QuartermasterConfigResolveOptions = {}
): Promise<QuartermasterConfig> {
	const cwd = options.cwd ?? process.cwd();
	const scope = options.scope ?? "auto";
	const existing = await readQuartermasterConfig(cwd, scope);
	const setsFile = options.setsFileOverride ?? existing?.setsFile ?? DEFAULT_SETS_FILE;
	const writeScope = scope === "global" ? "global" : "local";

	if (options.repoOverride) {
		return writeQuartermasterConfig({ repoPath: options.repoOverride, setsFile }, cwd, writeScope);
	}

	if (existing) {
		await validateRepoPath(existing.repoPath);
		return { repoPath: existing.repoPath, setsFile };
	}

	if (options.ctx?.hasUI) {
		if (!options.prompt) {
			throw new Error("Interactive prompt unavailable for Quartermaster repo path.");
		}
		const response = await options.prompt("Path to shared Quartermaster repo:");
		const repoPath = String(response ?? "").trim();
		return writeQuartermasterConfig({ repoPath, setsFile }, cwd, writeScope);
	}

	throw new Error("Quartermaster repo path not configured. Run `/quartermaster setup`.");
}

export { DEFAULT_SETS_FILE };
export type {
	QuartermasterConfig,
	QuartermasterConfigInput,
	QuartermasterConfigResolveOptions,
	QuartermasterConfigScope,
};
