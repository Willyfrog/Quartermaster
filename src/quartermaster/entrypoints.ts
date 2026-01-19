import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
	active?: "local" | "global";
};

function getGlobalExtensionsDir(): string {
	const baseDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
	return path.join(baseDir, "extensions");
}

function getLocalExtensionsDir(cwd: string = process.cwd()): string {
	return path.join(cwd, ".pi", "extensions");
}

function detectInstallInfo(cwd: string = process.cwd()): QuartermasterInstallInfo {
	const localDir = getLocalExtensionsDir(cwd);
	const globalDir = getGlobalExtensionsDir();
	const localPath = path.join(localDir, EXTENSION_FILENAME);
	const globalPath = path.join(globalDir, EXTENSION_FILENAME);
	const localExists = fs.existsSync(localPath);
	const globalExists = fs.existsSync(globalPath);
	let active: "local" | "global" | undefined;
	const runningPath = typeof __filename === "string" ? path.resolve(__filename) : "";
	if (runningPath) {
		const normalizedRunning = path.normalize(runningPath);
		const localRoot = `${path.normalize(localDir)}${path.sep}`;
		const globalRoot = `${path.normalize(globalDir)}${path.sep}`;
		if (normalizedRunning.startsWith(localRoot)) {
			active = "local";
		} else if (normalizedRunning.startsWith(globalRoot)) {
			active = "global";
		}
	}

	return {
		localPath,
		globalPath,
		localExists,
		globalExists,
		active,
	};
}

function formatInstallMessage(
	info: QuartermasterInstallInfo,
	cwd: string = process.cwd()
): { ok: boolean; message: string } {
	const resolvedCwd = path.resolve(cwd);
	const resolvedLocalPath = path.resolve(info.localPath);
	const localDisplay = resolvedLocalPath.startsWith(`${resolvedCwd}${path.sep}`)
		? `./${path.relative(resolvedCwd, resolvedLocalPath).split(path.sep).join("/")}`
		: info.localPath;
	const globalDisplay = info.globalPath;

	if (!info.localExists && !info.globalExists) {
		return {
			ok: false,
			message:
				"Unexpected: Quartermaster is running but no local or global installation was found. Please file a bug at https://github.com/Willyfrog/Quartermaster with details on how you reached this state.",
		};
	}

	if (info.active === "local") {
		return {
			ok: true,
			message: info.globalExists
				? `Quartermaster is installed locally (active) and globally. Using ${localDisplay}.`
				: `Quartermaster is installed locally (${localDisplay}).`,
		};
	}

	if (info.active === "global") {
		return {
			ok: true,
			message: info.localExists
				? `Quartermaster is installed globally (active) and locally. Using ${globalDisplay}.`
				: `Quartermaster is installed globally (${globalDisplay}).`,
		};
	}

	if (info.localExists && info.globalExists) {
		return {
			ok: true,
			message:
				"Quartermaster is installed locally and globally. Pi will prefer the local installation for this repo.",
		};
	}

	if (info.localExists) {
		return { ok: true, message: `Quartermaster is installed locally (${localDisplay}).` };
	}

	return { ok: true, message: `Quartermaster is installed globally (${globalDisplay}).` };
}

function defaultExecute(
	parsed: QuartermasterParsedArgs,
	_context: QuartermasterExecuteContext
): QuartermasterExecuteResult {
	const info = detectInstallInfo();
	const outcome = formatInstallMessage(info);
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
};
