import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	QUARTERMASTER_COMMAND,
	parseQuartermasterArgs,
	registerQuartermasterCommand,
} from "../src/quartermaster/entrypoints";
import type { QuartermasterExecute } from "../src/quartermaster/entrypoints";

void test("parseQuartermasterArgs splits args and subcommand", () => {
	const parsed = parseQuartermasterArgs("install set writer");
	assert.equal(parsed.subcommand, "install");
	assert.deepEqual(parsed.args, ["set", "writer"]);
	assert.deepEqual(parsed.raw, ["install", "set", "writer"]);
});

void test("parseQuartermasterArgs handles empty input", () => {
	const parsed = parseQuartermasterArgs("  ");
	assert.equal(parsed.subcommand, "");
	assert.deepEqual(parsed.args, []);
	assert.deepEqual(parsed.raw, []);
});

void test("parseQuartermasterArgs filters array input", () => {
	const parsed = parseQuartermasterArgs(["list", "", "skills", " "]);
	assert.equal(parsed.subcommand, "list");
	assert.deepEqual(parsed.args, ["skills"]);
	assert.deepEqual(parsed.raw, ["list", "skills"]);
});

void test("parseQuartermasterArgs tolerates non-string input", () => {
	const parsed = parseQuartermasterArgs(null);
	assert.equal(parsed.subcommand, "");
	assert.deepEqual(parsed.args, []);
	assert.deepEqual(parsed.raw, []);
});

type TestQuartermasterUI = {
	notify: (message: string, level: "info" | "error") => void;
};

type TestQuartermasterContext = {
	hasUI?: boolean;
	ui?: TestQuartermasterUI;
};

type TestQuartermasterHandler = (args: string | undefined, ctx: TestQuartermasterContext) => Promise<void> | void;

type TestRegisterCommandOptions = {
	handler: TestQuartermasterHandler;
};

void test("registerQuartermasterCommand wires command handler", async () => {
	const calls: Array<{
		name: string;
		options: TestRegisterCommandOptions;
	}> = [];
	const pi = {
		registerCommand: (name: string, options: TestRegisterCommandOptions) => {
			calls.push({ name, options });
		},
	};

	const execute: QuartermasterExecute = (parsed, context) => ({ ok: true, parsed, context });

	registerQuartermasterCommand(pi, execute);

	assert.equal(calls.length, 1);
	assert.equal(calls[0].name, QUARTERMASTER_COMMAND);

	await calls[0].options.handler("list skills", { hasUI: false });
});

void test("default quartermaster command reports missing install", async () => {
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "quartermaster-test-"));
	process.env.PI_CODING_AGENT_DIR = tempDir;

	let handler: TestQuartermasterHandler | undefined;
	const pi = {
		registerCommand: (_name: string, options: TestRegisterCommandOptions) => {
			handler = options.handler;
		},
	};

	let notifiedMessage: string | undefined;
	registerQuartermasterCommand(pi);
	assert.ok(handler, "Expected quartermaster handler to be registered.");

	try {
		await handler(undefined, {
			hasUI: true,
			ui: {
				notify: (message: string) => {
					notifiedMessage = message;
				},
			},
		});
	} finally {
		if (originalAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		}
		await fs.rm(tempDir, { recursive: true, force: true });
	}

	assert.ok(
		notifiedMessage?.includes(
			"Unexpected: Quartermaster is running but no local or global installation was found."
		),
		`Unexpected message: ${notifiedMessage}`
	);
	assert.ok(
		notifiedMessage?.includes("https://github.com/Willyfrog/Quartermaster"),
		`Expected bug report URL in message: ${notifiedMessage}`
	);
});

