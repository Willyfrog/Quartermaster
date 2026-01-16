export const QUARTERMASTER_COMMAND = "quartermaster";

type QuartermasterArgsInput = string | string[] | null | undefined;

type QuartermasterParsedArgs = {
	raw: string[];
	subcommand: string;
	args: string[];
};

type QuartermasterCommandContext = {
	hasUI?: boolean;
	prompt?: (message: string) => Promise<string> | string;
	ui?: {
		notify: (message: string, level: "info" | "error") => void;
	};
};

type QuartermasterExecuteContext = {
	source: "command" | "cli";
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

async function defaultExecute(
	parsed: QuartermasterParsedArgs,
	context: QuartermasterExecuteContext
): Promise<QuartermasterExecuteResult> {
	return {
		ok: false,
		message: `Quartermaster is not implemented yet (source: ${context.source}).`,
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
			const result = await execute(parsed, { source: "command", ctx });
			if (result?.message) {
				notifyIfPossible(ctx, result.message, result.ok);
			}
		},
	});
}

export async function runQuartermasterCli(
	argv: QuartermasterArgsInput,
	execute: QuartermasterExecute = defaultExecute
): Promise<QuartermasterExecuteResult> {
	const parsed = parseQuartermasterArgs(argv);
	return execute(parsed, { source: "cli" });
}

export type {
	QuartermasterArgsInput,
	QuartermasterCommandContext,
	QuartermasterExecute,
	QuartermasterExecuteContext,
	QuartermasterExecuteResult,
	QuartermasterParsedArgs,
	QuartermasterExtensionApi,
};
