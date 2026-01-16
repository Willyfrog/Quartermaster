import { executeQuartermaster } from "./commands";
import { runQuartermasterCli as run } from "./entrypoints";

export async function runQuartermasterCli(argv: string | string[] | null | undefined) {
	return run(argv, executeQuartermaster);
}
