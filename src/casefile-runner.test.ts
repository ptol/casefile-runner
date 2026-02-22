import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  executeCasefileFile,
  loadCasefile,
  parseCasefile,
  runCasefile,
  type Casefile
} from './casefile-runner.ts';

async function createTempCasefile(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'casefile-runner-'));
  const casePath = join(dir, 'fixture.case.yaml');
  await writeFile(casePath, source, 'utf8');
  return casePath;
}

test('parseCasefile parses args, files, stdout, and normalized stderr from CRLF source', () => {
  const source =
    'args:\r\n  - input/a.txt\r\ninput/a.txt: |\r\n  hello\r\nstdout: |\r\n  ok\r\nstderr: |\r\n  warn\r\n';

  const parsed = parseCasefile(source);

  assert.deepEqual(parsed.args, ['input/a.txt']);
  assert.deepEqual(parsed.files, [{ path: 'input/a.txt', content: 'hello\n' }]);
  assert.equal(parsed.expectedStdout, 'ok\n');
  assert.equal(parsed.expectedStderr, 'warn');
});

test('parseCasefile validates required structure and field types', () => {
  assert.throws(() => parseCasefile('[]\n'), /Case file must be a YAML object\./);
  assert.throws(() => parseCasefile('args: foo\nstdout: ok\nin.txt: hi\n'), /`args` as a YAML list/);
  assert.throws(
    () => parseCasefile('args:\n  - 1\nstdout: ok\nin.txt: hi\n'),
    /`args` entry at index 0 must be a string/
  );
  assert.throws(
    () => parseCasefile('args:\n  - in.txt\nin.txt: hi\n'),
    /at least one expected channel/
  );
  assert.throws(
    () => parseCasefile('args:\n  - in.txt\nstdout: 1\nin.txt: hi\n'),
    /`stdout` value must be a string/
  );
  assert.throws(
    () => parseCasefile('args:\n  - in.txt\nstderr: 1\nin.txt: hi\n'),
    /`stderr` value must be a string/
  );
  assert.throws(
    () => parseCasefile('args:\n  - in.txt\nstdout: ok\n'),
    /at least one fixture file key/
  );
  assert.throws(
    () => parseCasefile('args:\n  - in.txt\nstdout: ok\n"  ": hi\n'),
    /empty fixture file key/
  );
  assert.throws(
    () => parseCasefile('args:\n  - in.txt\nstdout: ok\nin.txt: 1\n'),
    /must map to string content/
  );
});

test('loadCasefile reads and parses a fixture from disk', async () => {
  const casePath = await createTempCasefile('args:\n  - a.txt\na.txt: hi\nstdout: done\n');
  const loaded = await loadCasefile(casePath);

  assert.deepEqual(loaded, {
    args: ['a.txt'],
    files: [{ path: 'a.txt', content: 'hi' }],
    expectedStdout: 'done',
    expectedStderr: null
  });
});

test('runCasefile throws when stdout-only case exits non-zero', async () => {
  const testCase: Casefile = {
    args: [],
    files: [{ path: 'in.txt', content: 'x' }],
    expectedStdout: 'x',
    expectedStderr: null
  };

  await assert.rejects(
    runCasefile(testCase, async () => ({ stdout: '', stderr: 'bad', exitCode: 2 })),
    /Case execution failed with exit code 2: bad/
  );
});

test('runCasefile throws when stderr-only case exits zero', async () => {
  const testCase: Casefile = {
    args: [],
    files: [{ path: 'in.txt', content: 'x' }],
    expectedStdout: null,
    expectedStderr: 'warn'
  };

  await assert.rejects(
    runCasefile(testCase, async () => ({ stdout: '', stderr: 'warn', exitCode: 0 })),
    /Expected non-zero exit code/
  );
});

test('runCasefile returns actual and expected channels on normal execution', async () => {
  const testCase: Casefile = {
    args: ['in.txt'],
    files: [{ path: 'in.txt', content: 'hello' }],
    expectedStdout: 'hello',
    expectedStderr: null
  };

  const result = await runCasefile(testCase, async (files, args) => {
    assert.deepEqual(args, ['in.txt']);
    assert.deepEqual(files, [{ path: 'in.txt', content: 'hello' }]);

    return {
      stdout: 'hello',
      stderr: '',
      exitCode: 0
    };
  });

  assert.deepEqual(result, {
    actualStdout: 'hello',
    expectedStdout: 'hello',
    actualStderr: '',
    expectedStderr: null
  });
});

test('executeCasefileFile without update mode returns run result only', async () => {
  const casePath = await createTempCasefile(
    'args:\n  - input.txt\ninput.txt: hello\nstdout: hello\nstderr: |\n  warn\n'
  );

  const result = await executeCasefileFile(
    casePath,
    async () => ({
      stdout: 'actual-out',
      stderr: 'actual-err',
      exitCode: 0
    }),
    { updateExpected: false }
  );

  assert.deepEqual(result, {
    actualStdout: 'actual-out',
    expectedStdout: 'hello',
    actualStderr: 'actual-err',
    expectedStderr: 'warn'
  });
});

test('executeCasefileFile update mode rewrites expectations and omits stderr when not needed', async () => {
  const casePath = await createTempCasefile('args:\n  - in.txt\nin.txt: before\nstdout: old\n');

  const result = await executeCasefileFile(
    casePath,
    async (files, args) => {
      assert.deepEqual(args, ['in.txt']);
      assert.deepEqual(files, [{ path: 'in.txt', content: 'before' }]);

      return {
        stdout: 'new-stdout',
        stderr: '',
        exitCode: 0
      };
    },
    { updateExpected: true }
  );

  assert.deepEqual(result, {
    actualStdout: 'new-stdout',
    expectedStdout: 'new-stdout',
    actualStderr: '',
    expectedStderr: null
  });

  const updatedSource = await readFile(casePath, 'utf8');
  assert.match(updatedSource, /stdout:/);
  assert.doesNotMatch(updatedSource, /^stderr:/m);

  const reparsed = parseCasefile(updatedSource);
  assert.equal(reparsed.expectedStdout, 'new-stdout');
  assert.equal(reparsed.expectedStderr, null);
});

test('executeCasefileFile update mode includes stderr on non-zero exit', async () => {
  const casePath = await createTempCasefile('args:\n  - in.txt\nin.txt: before\nstdout: old\n');

  const result = await executeCasefileFile(
    casePath,
    async () => ({
      stdout: '',
      stderr: '',
      exitCode: 3
    }),
    { updateExpected: true }
  );

  assert.deepEqual(result, {
    actualStdout: '',
    expectedStdout: '',
    actualStderr: '',
    expectedStderr: ''
  });

  const updatedSource = await readFile(casePath, 'utf8');
  assert.match(updatedSource, /^stderr:/m);
});
