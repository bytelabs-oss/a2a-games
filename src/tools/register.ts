import { HARNESSES, isHarness, type HarnessName } from "./harnesses.ts";

// node src/tools/register.ts <claude|copilot|all>         registers the tools, replacing any earlier registration
// node src/tools/register.ts remove <claude|copilot|all>  takes them out again
const remove = process.argv[2] === "remove";
const asked = process.argv[remove ? 3 : 2];
const names: HarnessName[] = asked === "all" ? (Object.keys(HARNESSES) as HarnessName[]) : isHarness(asked) ? [asked] : [];
if (!names.length) {
  const harnesses = `<${Object.keys(HARNESSES).join("|")}|all>`;
  console.error(`Usage: node src/tools/register.ts ${harnesses}\n       node src/tools/register.ts remove ${harnesses}`);
  process.exit(1);
}
try {
  for (const name of names) remove ? HARNESSES[name].unregister() : HARNESSES[name].register();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
