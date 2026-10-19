/**
 * Hand-rolled argv parsing for the repo-lens CLI.
 *
 * Zero runtime dependencies by project principle, so this is a small
 * command-aware flag scanner rather than a parser library.
 *
 * Grammar:
 *   repo-lens analyze [dir=.] [--json] [--no-cache] [--no-gitignore]
 *   repo-lens map     [dir=.] [--max-depth N=4] [--no-cache]
 *   repo-lens --help | --version
 */

/** Error whose message is meant for the user; printed as `repo-lens: <msg>`. */
export class CliError extends Error {
  override readonly name = 'CliError';
}

export interface AnalyzeOptions {
  /** Target directory as typed by the user (default "."). */
  dir: string;
  /** --json: print the raw profile instead of the human summary. */
  json: boolean;
  /** false when --no-cache was passed: skip writing .repo-lens/profile.json. */
  cache: boolean;
  /** false when --no-gitignore was passed: ignore .gitignore rules. */
  gitignore: boolean;
}

export interface MapOptions {
  dir: string;
  /** --max-depth N (default 4). */
  maxDepth: number;
  /** false when --no-cache was passed: bypass the cached profile. */
  cache: boolean;
}

export type ParsedCommand =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'analyze'; options: AnalyzeOptions }
  | { kind: 'map'; options: MapOptions };

const COMMANDS = new Set(['analyze', 'map']);
const DEFAULT_MAX_DEPTH = 4;

function isHelpFlag(token: string): boolean {
  return token === '--help' || token === '-h';
}

function isVersionFlag(token: string): boolean {
  return token === '--version' || token === '-v';
}

function unknownOption(token: string): CliError {
  return new CliError(`unknown option: ${token} (run 'repo-lens --help' for usage)`);
}

function optionForWrongCommand(token: string, command: string): CliError {
  return new CliError(`option ${token} is only valid with the '${command}' command`);
}

/**
 * Parse `process.argv.slice(2)`.
 *
 * @throws {CliError} on any invalid invocation; callers print
 *   `repo-lens: <message>` to stderr and exit 1.
 */
export function parseArgs(argv: string[]): ParsedCommand {
  // Help / version win wherever they appear (`repo-lens analyze --help` too).
  if (argv.some(isHelpFlag)) return { kind: 'help' };
  if (argv.some(isVersionFlag)) return { kind: 'version' };
  if (argv.length === 0) return { kind: 'help' };

  // The command must be the first token; bare flags with no command are an error.
  const command = argv[0]!;
  if (command.startsWith('-')) {
    throw new CliError(`missing command: expected 'analyze' or 'map'`);
  }
  if (!COMMANDS.has(command)) {
    throw new CliError(`unknown command: ${command} (expected 'analyze' or 'map')`);
  }

  let dir: string | null = null;
  let json = false;
  let cache = true;
  let gitignore = true;
  let maxDepth = DEFAULT_MAX_DEPTH;

  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]!;

    if (!token.startsWith('-')) {
      if (dir !== null) {
        throw new CliError(`unexpected argument: ${token} (only one directory is accepted)`);
      }
      dir = token;
      continue;
    }

    // Support both `--flag value` and `--flag=value`.
    const eq = token.indexOf('=');
    const name = eq === -1 ? token : token.slice(0, eq);
    const inlineValue = eq === -1 ? null : token.slice(eq + 1);

    const takeValue = (): string => {
      if (inlineValue !== null) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new CliError(`option ${name} requires a value`);
      }
      i += 1;
      return next;
    };

    switch (name) {
      case '--no-cache':
        if (inlineValue !== null) throw unknownOption(token);
        cache = false;
        break;

      case '--json':
        if (inlineValue !== null) throw unknownOption(token);
        if (command !== 'analyze') throw optionForWrongCommand('--json', 'analyze');
        json = true;
        break;

      case '--no-gitignore':
        if (inlineValue !== null) throw unknownOption(token);
        if (command !== 'analyze') throw optionForWrongCommand('--no-gitignore', 'analyze');
        gitignore = false;
        break;

      case '--max-depth': {
        if (command !== 'map') throw optionForWrongCommand('--max-depth', 'map');
        const raw = takeValue();
        if (!/^\d+$/.test(raw)) {
          throw new CliError(`--max-depth requires a non-negative integer, got: ${raw}`);
        }
        maxDepth = Number(raw);
        break;
      }

      default:
        throw unknownOption(token);
    }
  }

  if (command === 'analyze') {
    return {
      kind: 'analyze',
      options: { dir: dir ?? '.', json, cache, gitignore },
    };
  }
  return {
    kind: 'map',
    options: { dir: dir ?? '.', maxDepth, cache },
  };
}
