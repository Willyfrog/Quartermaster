import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getQuartermasterGlobalConfigPath } from "./config";

export const QUARTERMASTER_COMMAND = "quartermaster";

type QuartermasterArgsInput = string | string[] | null | undefined;

type QuartermasterParsedArgs = {
	raw: string[];
	subcommand: string;
	args: string[];
};

type QuartermasterCommandContext = {
	hasUI?: boolean;
	prompt?: (message: string) => Promise<string | undefined> | string | undefined;
	ui?: {
		notify: (message: string, level: "info" | "error") => void;
		input?: (message: string) => Promise<string | undefined> | string | undefined;
	};
};

type QuartermasterExecuteContext = {
	ctx?: QuartermasterCommandContext;
};

type QuartermasterExecuteResult = {
	ok: boolean;
	message?: string;
	parsed?: QuartermasterParsedArgs;
};

type QuartermasterExecute = (
	parsed: QuartermasterParsedArgs,
	context: QuartermasterExecuteContext
) => Promise<QuartermasterExecuteResult> | QuartermasterExecuteResult;

type QuartermasterExtensionApi = {
	registerCommand: (
		name: string,
		options: {
			description?: string;
			handler: (args: string | undefined, ctx: QuartermasterCommandContext) => Promise<void> | void;
		}
	) => void;
};

function normalizeArgs(input: QuartermasterArgsInput): string[] {
	if (Array.isArray(input)) {
		return input.filter((value) => value && String(value).trim().length > 0);
	}

	if (typeof input === "string") {
		const trimmed = input.trim();
		return trimmed.length === 0 ? [] : trimmed.split(/\s+/u);
	}

	return [];
}

export function parseQuartermasterArgs(input: QuartermasterArgsInput): QuartermasterParsedArgs {
	const tokens = normalizeArgs(input);
	const [subcommand = "", ...args] = tokens;
	return {
		raw: tokens,
		subcommand,
		args,
	};
}

const EXTENSION_FILENAME = "quartermaster.bundle.js";

type QuartermasterInstallInfo = {
	localPath: string;
	globalPath: string;
	localExists: boolean;
	globalExists: boolean;
	localConfigPath: string;
	globalConfigPath: string;
	localConfigExists: boolean;
	globalConfigExists: boolean;
	active?: "local" | "global";
	customPath?: string;
};

type QuartermasterInstallOutcome = {
	ok: boolean;
	message: string;
};

function getGlobalExtensionsDir(): string {
	const baseDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
	return path.join(baseDir, "extensions");
}

function getLocalExtensionsDir(cwd: string = process.cwd()): string {
	return path.join(cwd, ".pi", "extensions");
}

function parseExtensionArg(argv: string[]): string | undefined {
	const extensionFlag = "--extension";
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === extensionFlag) {
			const next = argv[index + 1];
			return next && next.trim().length > 0 ? next : undefined;
		}

		if (value.startsWith(`${extensionFlag}=`)) {
			const [, extensionValue] = value.split("=", 2);
			return extensionValue && extensionValue.trim().length > 0 ? extensionValue : undefined;
		}
	}

	return undefined;
}

function detectInstallInfo(cwd: string = process.cwd()): QuartermasterInstallInfo {
	const localDir = getLocalExtensionsDir(cwd);
	const globalDir = getGlobalExtensionsDir();
	const localPath = path.join(localDir, EXTENSION_FILENAME);
	const globalPath = path.join(globalDir, EXTENSION_FILENAME);
	const localExists = fs.existsSync(localPath);
	const globalExists = fs.existsSync(globalPath);
	const localConfigPath = path.join(cwd, ".pi", "quartermaster.json");
	const globalConfigPath = getQuartermasterGlobalConfigPath();
	const localConfigExists = fs.existsSync(localConfigPath);
	const globalConfigExists = fs.existsSync(globalConfigPath);
	const extensionArg = parseExtensionArg(process.argv);
	const customPath = extensionArg ? path.resolve(extensionArg) : undefined;

	return {
		localPath,
		globalPath,
		localExists,
		globalExists,
		localConfigPath,
		globalConfigPath,
		localConfigExists,
		globalConfigExists,
		customPath,
	};
}

function formatConfigMessage(info: QuartermasterInstallInfo, resolvedCwd: string): string {
	const resolvedLocalConfig = path.resolve(info.localConfigPath);
	const localConfigDisplay = resolvedLocalConfig.startsWith(`${resolvedCwd}${path.sep}`)
		? `./${path.relative(resolvedCwd, resolvedLocalConfig).split(path.sep).join("/")}`
		: info.localConfigPath;
	const globalConfigDisplay = info.globalConfigPath;

	if (info.localConfigExists && info.globalConfigExists) {
		return `Config: local (${localConfigDisplay}) and global (${globalConfigDisplay}).`;
	}

	if (info.localConfigExists) {
		return `Config: local (${localConfigDisplay}).`;
	}

	if (info.globalConfigExists) {
		return `Config: global (${globalConfigDisplay}).`;
	}

	return "Config: none found.";
}

function formatInstallMessage(
	info: QuartermasterInstallInfo,
	cwd: string = process.cwd()
): QuartermasterInstallOutcome {
	const resolvedCwd = path.resolve(cwd);
	const resolvedLocalPath = path.resolve(info.localPath);
	const localDisplay = resolvedLocalPath.startsWith(`${resolvedCwd}${path.sep}`)
		? `./${path.relative(resolvedCwd, resolvedLocalPath).split(path.sep).join("/")}`
		: info.localPath;
	const globalDisplay = info.globalPath;
	const resolvedCustomPath = info.customPath ? path.resolve(info.customPath) : "";
	const customDisplay = info.customPath
		? resolvedCustomPath.startsWith(`${resolvedCwd}${path.sep}`)
			? `./${path.relative(resolvedCwd, resolvedCustomPath).split(path.sep).join("/")}`
			: resolvedCustomPath
		: undefined;
	const configMessage = formatConfigMessage(info, resolvedCwd);

	if (customDisplay) {
		if (info.localExists && info.globalExists) {
			return {
				ok: true,
				message:
					`Quartermaster is running from a custom extension (${customDisplay}). Local and global installations are also present. ${configMessage}`,
			};
		}

		if (info.localExists) {
			return {
				ok: true,
				message: `Quartermaster is running from a custom extension (${customDisplay}). A local installation also exists (${localDisplay}). ${configMessage}`,
			};
		}

		if (info.globalExists) {
			return {
				ok: true,
				message: `Quartermaster is running from a custom extension (${customDisplay}). A global installation also exists (${globalDisplay}). ${configMessage}`,
			};
		}

		return {
			ok: true,
			message: `Quartermaster is running from a custom extension (${customDisplay}). ${configMessage}`,
		};
	}

	if (!info.localExists && !info.globalExists) {
		return {
			ok: false,
			message:
				`Unexpected: Quartermaster is running but no local or global installation was found. Please file a bug at https://github.com/Willyfrog/Quartermaster with details on how you reached this state. ${configMessage}`,
		};
	}

	if (info.active === "local") {
		return {
			ok: true,
			message: info.globalExists
				? `Quartermaster is installed locally (active) and globally. Using ${localDisplay}. ${configMessage}`
				: `Quartermaster is installed locally (${localDisplay}). ${configMessage}`,
		};
	}

	if (info.active === "global") {
		return {
			ok: true,
			message: info.localExists
				? `Quartermaster is installed globally (active) and locally. Using ${globalDisplay}. ${configMessage}`
				: `Quartermaster is installed globally (${globalDisplay}). ${configMessage}`,
		};
	}

	if (info.localExists && info.globalExists) {
		return {
			ok: true,
			message:
				`Quartermaster is installed locally and globally. Pi will prefer the local installation for this repo. ${configMessage}`,
		};
	}

	if (info.localExists) {
		return { ok: true, message: `Quartermaster is installed locally (${localDisplay}). ${configMessage}` };
	}

	return { ok: true, message: `Quartermaster is installed globally (${globalDisplay}). ${configMessage}` };
}

export function getQuartermasterInstallOutcome(cwd: string = process.cwd()): QuartermasterInstallOutcome {
	const info = detectInstallInfo(cwd);
	return formatInstallMessage(info, cwd);
}

function defaultExecute(
	parsed: QuartermasterParsedArgs,
	_context: QuartermasterExecuteContext
): QuartermasterExecuteResult {
	const outcome = getQuartermasterInstallOutcome();
	return {
		ok: outcome.ok,
		message: outcome.message,
		parsed,
	};
}

function notifyIfPossible(ctx: QuartermasterCommandContext | undefined, message: string, ok: boolean): void {
	if (!ctx || !ctx.hasUI || !ctx.ui) {
		return;
	}

	ctx.ui.notify(message, ok ? "info" : "error");
}

export function registerQuartermasterCommand(
	pi: QuartermasterExtensionApi,
	execute: QuartermasterExecute = defaultExecute
): void {
	pi.registerCommand(QUARTERMASTER_COMMAND, {
		description: "Manage shared skills, extensions, tools, and prompts",
		handler: async (args, ctx) => {
			const parsed = parseQuartermasterArgs(args ?? "");
			const result = await execute(parsed, { ctx });
			if (result?.message) {
				notifyIfPossible(ctx, result.message, result.ok);
			}
		},
	});
}

export type {
	QuartermasterArgsInput,
	QuartermasterCommandContext,
	QuartermasterExecute,
	QuartermasterExecuteResult,
	QuartermasterParsedArgs,
	QuartermasterExtensionApi,
	QuartermasterInstallOutcome,
};
