---
description: End-user guide for using casefile-runner to parse and execute YAML case files for CLI and integration tests.
---

# casefile-runner

## What It Is

`casefile-runner` helps you test CLI-style behavior using a single `.case.yaml` file that contains:

- CLI args
- Virtual input files
- Expected `stdout` and/or `stderr`

## Install

```bash
npm install casefile-runner
```

## Quick Example

### Case File

```yaml
args:
  - input/a.txt
input/a.txt: |
  hello
stdout: |
  hello
stderr: |
  warning: demo stderr line
```

### Test

```ts
import { executeCasefileFile } from 'casefile-runner';

const result = await executeCasefileFile('example.case.yaml', async (files, args) => {
  const fileMap = new Map(files.map((item) => [item.path, item.content]));
  const content = fileMap.get(args[0] ?? '') ?? '';

  return {
    stdout: content,
    stderr: 'warning: demo stderr line\n',
    exitCode: 0
  };
});
```

## API

- `parseCasefile(source)` parses raw YAML fixture text.
- `loadCasefile(path)` reads and parses a fixture file from disk.
- `runCasefile(testCase, executor)` runs an already-parsed case.
- `executeCasefileFile(path, executor, options)` reads, runs, and optionally updates expected output.

## Updating Expected Output

Pass `updateExpected: true` to rewrite `stdout`/`stderr` sections from actual output:

```ts
await executeCasefileFile(casePath, executor, { updateExpected: true });
```
