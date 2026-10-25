import fs from "node:fs";
import path from "node:path";

import { advice, blocks, days, driveLegs, drives, lodgings, resources, stages, todos, trip } from "./itinerarySeedData.mjs";
import { runPython } from "./pythonRunner.mjs";

const workbookPath = path.join("content", "aussie-itinerary.xlsx");
const tempPath = path.join("content", ".aussie-itinerary-seed.json");

if (fs.existsSync(workbookPath) && !process.argv.includes("--force")) {
  throw new Error(
    `Refusing to overwrite the authoritative workbook at ${workbookPath}. ` +
      "Pass --force only when intentionally rebuilding it from scripts/itinerarySeedData.mjs.",
  );
}

fs.mkdirSync(path.dirname(workbookPath), { recursive: true });
fs.writeFileSync(tempPath, JSON.stringify({
  Trip: trip,
  Stages: stages,
  Days: days,
  Blocks: blocks,
  Drives: drives,
  DriveLegs: driveLegs,
  Lodgings: lodgings,
  Todos: todos,
  Advice: advice,
  Resources: resources,
}));
runPython(["scripts/itinerary_excel.py", "write", tempPath, workbookPath]);
fs.rmSync(tempPath);

console.log(`Wrote ${workbookPath}`);
