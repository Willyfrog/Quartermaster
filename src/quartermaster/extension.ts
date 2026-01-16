import { executeQuartermaster } from "./commands";
import type { QuartermasterExtensionApi } from "./entrypoints";
import { registerQuartermasterCommand } from "./entrypoints";

export default function quartermasterExtension(pi: QuartermasterExtensionApi): void {
	registerQuartermasterCommand(pi, executeQuartermaster);
}
