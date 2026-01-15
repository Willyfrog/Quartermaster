import assert from "node:assert/strict";
import test from "node:test";
import {
	QUARTERMASTER_COMMAND,
	parseQuartermasterArgs,
	registerQuartermasterCommand,
	runQuartermasterCli,
} from "../src/quartermaster/entrypoints";

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
	const calls = [];
	const pi = {
		registerCommand: (name, options) => {
			calls.push({ name, options });
		},
	};

	const execute = async (parsed, context) => {
		return { ok: true, parsed, context };
	};

	registerQuartermasterCommand(pi, execute);

	assert.equal(calls.length, 1);
	assert.equal(calls[0].name, QUARTERMASTER_COMMAND);

	await calls[0].options.handler("list skills", { hasUI: false });
});

test("runQuartermasterCli passes parsed args to execute", async () => {
	const received = [];
	const execute = async (parsed, context) => {
		received.push({ parsed, context });
		return { ok: true };
	};

	await runQuartermasterCli(["list", "skills"], execute);

	assert.equal(received.length, 1);
	assert.equal(received[0].parsed.subcommand, "list");
	assert.deepEqual(received[0].parsed.args, ["skills"]);
	assert.equal(received[0].context.source, "cli");
});
