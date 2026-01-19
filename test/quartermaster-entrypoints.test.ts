import assert from "node:assert/strict";
import test from "node:test";
import {
	QUARTERMASTER_COMMAND,
	parseQuartermasterArgs,
	registerQuartermasterCommand,
} from "../src/quartermaster/entrypoints";
import type { QuartermasterExecute } from "../src/quartermaster/entrypoints";

test("parseQuartermasterArgs splits args and subcommand", () => {
	const parsed = parseQuartermasterArgs("install set writer");
	assert.equal(parsed.subcommand, "install");
	assert.deepEqual(parsed.args, ["set", "writer"]);
	assert.deepEqual(parsed.raw, ["install", "set", "writer"]);
});

test("parseQuartermasterArgs handles empty input", () => {
	const parsed = parseQuartermasterArgs("  ");
	assert.equal(parsed.subcommand, "");
	assert.deepEqual(parsed.args, []);
	assert.deepEqual(parsed.raw, []);
});

test("parseQuartermasterArgs filters array input", () => {
	const parsed = parseQuartermasterArgs(["list", "", "skills", " "]);
	assert.equal(parsed.subcommand, "list");
	assert.deepEqual(parsed.args, ["skills"]);
	assert.deepEqual(parsed.raw, ["list", "skills"]);
});

test("parseQuartermasterArgs tolerates non-string input", () => {
	const parsed = parseQuartermasterArgs(null);
	assert.equal(parsed.subcommand, "");
	assert.deepEqual(parsed.args, []);
	assert.deepEqual(parsed.raw, []);
});

test("registerQuartermasterCommand wires command handler", async () => {
	const calls: Array<{
		name: string;
		options: { handler: (args: string | undefined, ctx: { hasUI?: boolean }) => Promise<void> | void };
	}> = [];
	const pi = {
		registerCommand: (name: string, options: { handler: (args: string | undefined, ctx: { hasUI?: boolean }) => Promise<void> | void }) => {
			calls.push({ name, options });
		},
	};

	const execute: QuartermasterExecute = async (parsed, context) => {
		return { ok: true, parsed, context };
	};

	registerQuartermasterCommand(pi, execute);

	assert.equal(calls.length, 1);
	assert.equal(calls[0].name, QUARTERMASTER_COMMAND);

	await calls[0].options.handler("list skills", { hasUI: false });
});

