import { log } from "node:console";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const outputDirectory = path.resolve("dist/dashboard");

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function totalBytes(files, extensions) {
  return files
    .filter((file) => extensions.includes(path.extname(file)))
    .reduce((total, file) => total + statSync(file).size, 0);
}

if (!existsSync(path.join(outputDirectory, "index.html"))) {
  throw new Error("Dashboard build is missing. Run `npm run build` first.");
}

const files = listFiles(outputDirectory);
const sourceMaps = files.filter((file) => file.endsWith(".map"));
const measurements = [
  ["JavaScript", totalBytes(files, [".js"]), 350 * 1024],
  ["CSS", totalBytes(files, [".css"]), 100 * 1024],
  ["Images", totalBytes(files, [".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]), 350 * 1024],
  ["Dashboard total", totalBytes(files, files.map((file) => path.extname(file))), 800 * 1024],
];

const failures = measurements.filter(([, actual, limit]) => actual > limit);
if (sourceMaps.length > 0) {
  failures.push(["Source maps", sourceMaps.length, 0]);
}

for (const [label, actual, limit] of measurements) {
  log(`${label}: ${(actual / 1024).toFixed(1)} KiB / ${(limit / 1024).toFixed(1)} KiB`);
}

if (failures.length > 0) {
  throw new Error(`Production bundle budget exceeded: ${failures.map(([label]) => label).join(", ")}`);
}
