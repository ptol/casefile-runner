import { readFileSync, writeFileSync } from 'node:fs';

const releaseVersion = process.argv[2] ?? '';
const tagValue = process.argv[3] ?? '';
const packageJsonPath = process.argv[4] ?? 'package.json';

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!semverPattern.test(releaseVersion)) {
  console.error(
    `Tag must be a semver value like v1.2.3 or 1.2.3. Received: ${tagValue || '(empty)'}`
  );
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
packageJson.version = releaseVersion;
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log(`Publishing version ${releaseVersion}`);
