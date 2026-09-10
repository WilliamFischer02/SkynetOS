/**
 * Priming: the named, allowlisted things a terminal does BEFORE it hands you the prompt.
 *
 * docs/07-SECURITY.md is explicit: "Board JSON is data. It never contains executable code,
 * template expressions, or shell strings that aren't `startCommand`/`args` on a node that
 * declares them." So a node does NOT store `"npm update"`. It stores the id `npm-update`, and
 * the shell text lives here, in code, where it is reviewed, typechecked and tested.
 *
 * That is not bureaucracy. A board file is the thing an agent is allowed to edit; if priming
 * were a free shell string, "edit a node" and "run arbitrary code as William" would be the same
 * permission. They are not, and this file is the reason.
 *
 * Every step is also REAL-CHECKED before it runs. A step whose marker file is absent is skipped
 * with a printed line saying so, rather than failing loudly in a repo that has no package.json.
 * Prime directive 1: bind to reality, and show it broken instead of pretending.
 */

export const PRIME_STEP_IDS = [
  'claude',
  'git-fetch',
  'git-status',
  'npm-install',
  'npm-update',
  'npm-audit',
  'pip-self',
  'pip-reqs'
] as const;

export type PrimeStepId = (typeof PRIME_STEP_IDS)[number];

export interface PrimeStep {
  id: PrimeStepId;
  /** Shown in the node editor's ticker list. */
  label: string;
  /** One line, shown under the ticker. Says what actually runs. */
  help: string;
  /**
   * The PowerShell that runs. Never sourced from board JSON, never interpolated with node data.
   * A literal constant, which is what makes the whole scheme safe.
   */
  command: string;
  /**
   * Paths, relative to the working directory, that must exist for this step to apply. Empty
   * means it always applies. Any one of them is enough.
   */
  markers: readonly string[];
  /**
   * True when the step can change files in the repo (lockfiles, node_modules, site-packages).
   * Surfaced in the editor so "prime this session" never quietly rewrites a dependency tree.
   */
  mutates: boolean;
}

export const PRIME_STEPS: Record<PrimeStepId, PrimeStep> = {
  'claude': {
    id: 'claude',
    label: 'Update Claude Code',
    help: 'claude update — pulls the newest CLI before the session starts.',
    command: 'claude update',
    markers: [],
    mutates: false
  },
  'git-fetch': {
    id: 'git-fetch',
    label: 'Fetch git remotes',
    help: 'git fetch --all --prune — brings refs up to date. Does not touch your working tree.',
    command: 'git fetch --all --prune',
    markers: ['.git'],
    mutates: false
  },
  'git-status': {
    id: 'git-status',
    label: 'Show git status',
    help: 'git status --short --branch — so the session opens knowing what is uncommitted.',
    command: 'git status --short --branch',
    markers: ['.git'],
    mutates: false
  },
  'npm-install': {
    id: 'npm-install',
    label: 'npm install',
    help: 'Syncs node_modules to package-lock.json. Does not change which versions the lock names.',
    command: 'npm install',
    markers: ['package.json'],
    mutates: true
  },
  'npm-update': {
    id: 'npm-update',
    label: 'npm update',
    help: 'Moves dependencies to the newest versions your ranges allow AND rewrites package-lock.json.',
    command: 'npm update',
    markers: ['package.json'],
    mutates: true
  },
  'npm-audit': {
    id: 'npm-audit',
    label: 'npm audit (report only)',
    help: 'npm audit --omit=dev — reports vulnerabilities. Never fixes anything on its own.',
    command: 'npm audit --omit=dev',
    markers: ['package.json'],
    mutates: false
  },
  'pip-self': {
    id: 'pip-self',
    label: 'Upgrade pip',
    help: 'python -m pip install --upgrade pip — only in a repo that looks like Python.',
    command: 'python -m pip install --upgrade pip',
    markers: ['requirements.txt', 'pyproject.toml', 'setup.py'],
    mutates: false
  },
  'pip-reqs': {
    id: 'pip-reqs',
    label: 'pip install -r requirements.txt',
    help: 'Installs and upgrades everything requirements.txt names.',
    command: 'pip install -r requirements.txt --upgrade',
    markers: ['requirements.txt'],
    mutates: true
  }
};

/**
 * What a node primes with when it has never been told. Deliberately the three that cannot
 * rewrite a lockfile or a virtualenv: bring the CLI up to date, bring the refs up to date, and
 * say what is uncommitted. Anything that mutates a repo is opt-in per node.
 */
export const DEFAULT_PRIME: readonly PrimeStepId[] = ['claude', 'git-fetch', 'git-status'];

export function isPrimeStepId(value: string): value is PrimeStepId {
  return (PRIME_STEP_IDS as readonly string[]).includes(value);
}

/** Drop anything that is not a known id, preserving order and removing duplicates. */
export function normalisePrime(values: readonly string[] | undefined): PrimeStepId[] {
  if (!values) return [];
  const seen = new Set<PrimeStepId>();
  for (const value of values) if (isPrimeStepId(value)) seen.add(value);
  return [...seen];
}

/** The steps a node runs, resolved. `undefined` means "never configured" and gets the default. */
export function primeStepsFor(values: readonly string[] | undefined): PrimeStep[] {
  const ids = values === undefined ? [...DEFAULT_PRIME] : normalisePrime(values);
  return ids.map((id) => PRIME_STEPS[id]);
}
