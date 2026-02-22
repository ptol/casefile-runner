/**
 * Utilities for parsing and executing casefile `.case.yaml` fixtures in tests.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/**
 * Parsed file entry from a casefile input block.
 */
export interface CaseInputFile {
  path: string;
  content: string;
}

/**
 * Parsed representation of a casefile file.
 */
export interface Casefile {
  args: string[];
  files: CaseInputFile[];
  expectedStdout: string | null;
  expectedStderr: string | null;
}

/**
 * Callback that executes logic against parsed virtual input files.
 */
export type CasefileExecutor = (
  files: CaseInputFile[],
  args: string[]
) => Promise<CasefileExecutorOutput>;

/**
 * Output channels captured from a casefile executor.
 */
export interface CasefileExecutorOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Result returned after executing a casefile `.case.yaml` fixture.
 */
export interface CasefileRunResult {
  actualStdout: string;
  expectedStdout: string | null;
  actualStderr: string;
  expectedStderr: string | null;
}

/**
 * Configuration for running and optionally updating a casefile fixture file.
 */
export interface ExecuteCasefileFileOptions {
  updateExpected?: boolean;
}

/**
 * Parses and validates a YAML object from a casefile `.case.yaml` fixture source.
 * @param source Entire `.case.yaml` file content.
 * @returns Parsed top-level mapping as key-value pairs.
 */
function isCaseRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parses and validates a YAML object from a casefile `.case.yaml` fixture source.
 * @param source Entire `.case.yaml` file content.
 * @returns Parsed top-level mapping as key-value pairs.
 */
function parseCaseRecord(source: string): Record<string, unknown> {
  const parsed = parseYaml(source) as unknown;
  if (!isCaseRecord(parsed)) {
    throw new Error('Case file must be a YAML object.');
  }
  return parsed;
}

/**
 * Normalizes expected stderr from YAML block scalars.
 * YAML `|` clipping appends one trailing newline by default; strip one terminal
 * newline so single-line stderr expectations remain stable.
 */
function normalizeExpectedStderr(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  return value.endsWith('\n') ? value.slice(0, -1) : value;
}

/**
 * Parses fixture content from YAML keys for args, files, and expected output channels.
 * @param source Entire `.case.yaml` file content.
 * @returns Parsed input files and expected output.
 */
export function parseCasefile(source: string): Casefile {
  const normalized = source.replace(/\r\n/g, '\n');
  const caseRecord = parseCaseRecord(normalized);

  const argsValue = caseRecord['args'];
  if (!Array.isArray(argsValue)) {
    throw new Error('Case file must define `args` as a YAML list.');
  }

  const args: string[] = argsValue.map((arg, index) => {
    if (typeof arg !== 'string') {
      throw new Error(`Case file \`args\` entry at index ${index.toString()} must be a string.`);
    }

    return arg;
  });

  const hasStdout = Object.hasOwn(caseRecord, 'stdout');
  const hasStderr = Object.hasOwn(caseRecord, 'stderr');
  if (!hasStdout && !hasStderr) {
    throw new Error(
      'Case file must define at least one expected channel: `stdout` and/or `stderr`.'
    );
  }

  const stdoutValue = caseRecord['stdout'];
  if (stdoutValue !== undefined && typeof stdoutValue !== 'string') {
    throw new Error('Case file `stdout` value must be a string.');
  }

  const stderrValue = caseRecord['stderr'];
  if (stderrValue !== undefined && typeof stderrValue !== 'string') {
    throw new Error('Case file `stderr` value must be a string.');
  }

  const files = Object.entries(caseRecord)
    .filter(([key]) => key !== 'args' && key !== 'stdout' && key !== 'stderr')
    .map(([path, content]) => {
      if (path.trim().length === 0) {
        throw new Error('Case file contains an empty fixture file key.');
      }

      if (typeof content !== 'string') {
        throw new Error(`Fixture file \`${path}\` must map to string content.`);
      }

      return { path, content };
    });

  if (files.length === 0) {
    throw new Error('Case file must define at least one fixture file key.');
  }

  return {
    args,
    files,
    expectedStdout: typeof stdoutValue === 'string' ? stdoutValue : null,
    expectedStderr: normalizeExpectedStderr(typeof stderrValue === 'string' ? stderrValue : null)
  };
}

/**
 * Reads and parses a casefile `.case.yaml` fixture from disk.
 * @param caseFilePath Absolute or workspace-relative path to the `.case.yaml` file.
 * @returns Parsed fixture representation.
 */
export async function loadCasefile(caseFilePath: string): Promise<Casefile> {
  const caseSource = await readFile(caseFilePath, 'utf8');
  return parseCasefile(caseSource);
}

/**
 * Executes a casefile `.case.yaml` file and optionally rewrites expectation output on mismatch.
 * @param caseFilePath Absolute or workspace-relative path to the `.case.yaml` file.
 * @param executor Callback that consumes parsed input files and returns actual output.
 * @param options Optional execution behavior, including update mode.
 * @returns Actual and expected outputs for assertion.
 */
export async function executeCasefileFile(
  caseFilePath: string,
  executor: CasefileExecutor,
  options: ExecuteCasefileFileOptions = {}
): Promise<CasefileRunResult> {
  const source = await readFile(caseFilePath, 'utf8');
  const normalized = source.replace(/\r\n/g, '\n');
  const testCase = parseCasefile(normalized);
  const originalCaseRecord = parseCaseRecord(normalized);

  if (options.updateExpected === true) {
    const output = await executor(testCase.files, testCase.args);
    const includeStdout = Object.hasOwn(originalCaseRecord, 'stdout') || output.stdout.length > 0;
    const includeStderr =
      Object.hasOwn(originalCaseRecord, 'stderr') ||
      output.stderr.length > 0 ||
      output.exitCode !== 0;

    const updatedCaseRecord: Record<string, unknown> = {
      args: testCase.args
    };

    for (const inputFile of testCase.files) {
      updatedCaseRecord[inputFile.path] = inputFile.content;
    }

    if (includeStdout) {
      updatedCaseRecord['stdout'] = output.stdout;
    }

    if (includeStderr) {
      updatedCaseRecord['stderr'] = output.stderr;
    }

    const updatedSource = stringifyYaml(updatedCaseRecord);
    if (updatedSource.replace(/\r\n/g, '\n') !== normalized) {
      await writeFile(caseFilePath, updatedSource, 'utf8');
    }

    return {
      actualStdout: output.stdout,
      expectedStdout: includeStdout ? output.stdout : null,
      actualStderr: output.stderr,
      expectedStderr: includeStderr ? output.stderr : null
    };
  }

  return runCasefile(testCase, executor);
}

/**
 * Runs a parsed casefile fixture using a provided executor callback.
 * @param testCase Parsed fixture with virtual input files and expected output.
 * @param executor Callback that consumes fixture files and returns actual output.
 * @returns Actual and expected outputs for assertion.
 */
export async function runCasefile(
  testCase: Casefile,
  executor: CasefileExecutor
): Promise<CasefileRunResult> {
  const output = await executor(testCase.files, testCase.args);

  const hasStdoutExpectation = testCase.expectedStdout !== null;
  const hasStderrExpectation = testCase.expectedStderr !== null;

  if (hasStdoutExpectation && !hasStderrExpectation && output.exitCode !== 0) {
    throw new Error(
      `Case execution failed with exit code ${output.exitCode.toString()}: ${output.stderr}`
    );
  }

  if (hasStderrExpectation && !hasStdoutExpectation && output.exitCode === 0) {
    throw new Error('Expected non-zero exit code for `stderr` case.');
  }

  return {
    actualStdout: output.stdout,
    expectedStdout: testCase.expectedStdout,
    actualStderr: output.stderr,
    expectedStderr: testCase.expectedStderr
  };
}
