import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const gradlePath = path.join(rootDir, "android", "app", "build.gradle");
const packageJsonPath = path.join(rootDir, "package.json");

const gradleContent = fs.readFileSync(gradlePath, "utf8");

const versionCodeRegex = /versionCode\s+(\d+)/;
const versionNameRegex = /versionName\s+"([^"]+)"/;

const versionCodeMatch = gradleContent.match(versionCodeRegex);
if (!versionCodeMatch) {
  throw new Error("No se encontro versionCode en android/app/build.gradle");
}

const currentVersionCode = Number(versionCodeMatch[1]);
const nextVersionCode = currentVersionCode + 1;
const nextVersionName = `1.0.${nextVersionCode}`;

let updatedGradle = gradleContent.replace(
  versionCodeRegex,
  `versionCode ${nextVersionCode}`
);

if (!versionNameRegex.test(updatedGradle)) {
  throw new Error("No se encontro versionName en android/app/build.gradle");
}

updatedGradle = updatedGradle.replace(
  versionNameRegex,
  `versionName "${nextVersionName}"`
);

fs.writeFileSync(gradlePath, updatedGradle, "utf8");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
packageJson.version = nextVersionName;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

console.log(`✅ Version bumped to ${nextVersionName} (code: ${nextVersionCode})`);
