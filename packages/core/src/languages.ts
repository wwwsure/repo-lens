/** 扩展名 → 语言名。 */
export const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  pyi: 'Python',
  rs: 'Rust',
  go: 'Go',
  java: 'Java',
  kt: 'Kotlin',
  kts: 'Kotlin',
  swift: 'Swift',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  hpp: 'C++',
  hh: 'C++',
  cs: 'C#',
  rb: 'Ruby',
  php: 'PHP',
  scala: 'Scala',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  ps1: 'PowerShell',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  md: 'Markdown',
  mdx: 'Markdown',
  sql: 'SQL',
  lua: 'Lua',
  dart: 'Dart',
  ex: 'Elixir',
  exs: 'Elixir',
  hs: 'Haskell',
  r: 'R',
  proto: 'Protobuf',
  graphql: 'GraphQL',
  tf: 'Terraform',
};

/** 无扩展名但可识别语言的文件名。 */
export const NAME_LANGUAGES: Record<string, string> = {
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  'cmakelists.txt': 'CMake',
  'go.mod': 'Go',
  'go.sum': 'Go',
  rakefile: 'Ruby',
  gemfile: 'Ruby',
};

/**
 * 根据文件名识别编程语言。
 * @param filePath 文件名或相对路径（仅使用最后一段）。
 * @returns 语言名，无法识别返回 null。
 */
export function detectLanguage(filePath: string): string | null {
  const segments = filePath.split(/[/\\]/);
  const base = segments[segments.length - 1]!.toLowerCase();
  const named = NAME_LANGUAGES[base];
  if (named) return named;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1);
  return EXTENSION_LANGUAGES[ext] ?? null;
}
