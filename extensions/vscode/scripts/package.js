const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const version = JSON.parse(
  fs.readFileSync("./package.json", { encoding: "utf-8" }),
).version;

const args = process.argv.slice(2);
let target;
const targetIdx = args.indexOf("--target");
if (targetIdx !== -1 && args[targetIdx + 1]) {
  target = args[targetIdx + 1];
}

if (!fs.existsSync("build")) {
  fs.mkdirSync("build");
}

// Clean any existing vsix files in build
fs.readdirSync("build").forEach((file) => {
  if (file.endsWith(".vsix")) {
    try {
      fs.unlinkSync(path.join("build", file));
    } catch (e) {}
  }
});

const isPreRelease = args.includes("--pre-release");
let command = isPreRelease
  ? "npx @vscode/vsce package --out ./build --pre-release --no-dependencies"
  : "npx @vscode/vsce package --out ./build --no-dependencies";

if (target) {
  command += ` --target ${target}`;
}

console.log(`Running: ${command}`);
try {
  execSync(command, { stdio: "inherit" });
  console.log(
    `vsce package completed - extension created in extensions/vscode/build/`,
  );
} catch (error) {
  console.error("vsce package failed:", error);
  process.exit(1);
}

