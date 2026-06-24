import fs from "node:fs";
import path from "node:path";

import { blocks, days, resources } from "./itinerarySeedData.mjs";
import { runPython } from "./pythonRunner.mjs";

const workbookPath = path.join("content", "aussie-itinerary.xlsx");
const tempPath = path.join("content", ".aussie-itinerary-seed.json");

fs.mkdirSync(path.dirname(workbookPath), { recursive: true });
fs.writeFileSync(tempPath, JSON.stringify({ Days: days, Blocks: blocks, Resources: resources }));
runPython(["scripts/itinerary_excel.py", "write", tempPath, workbookPath]);
fs.rmSync(tempPath);

console.log(`Wrote ${workbookPath}`);
