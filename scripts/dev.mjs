#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ENV_FILE = ".env";
const DEFAULT_WORKTREE_DIR = ".worktrees";
const DEFAULT_CONFIG_FILE = "dev.config.mjs";

const asArray = (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

export const slugify = (branchName) => {
  const slug = branchName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

  if (!slug) throw new Error(`Cannot create a slug from '${branchName}'`);
  return slug;
};

export const parseEnv = (contents) => {
  const env = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator === -1) continue;

    const key = normalized.slice(0, separator).trim();
    const value = normalized.slice(separator + 1).trim();
    if (key) env[key] = value.replace(/^(['"])(.*)\1$/, "$2");
  }

  return env;
};

export const serializeEnv = (env) =>
  Object.entries(env)
    .map(([key, value]) => `${key}=${value ?? ""}`)
    .join("\n") + "\n";

export const readEnv = async (filePath) => {
  try {
    return parseEnv(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
};

export const writeEnv = (filePath, env) => fs.writeFile(filePath, serializeEnv(env), { mode: 0o600 });

export const managedEnvKeys = (config) => [
  ...Object.keys(config.ports ?? {}),
  ...Object.keys(config.env ?? {}),
  ...asArray(config.managedEnvKeys),
];

export const commandEnv = ({ config, baseEnv = process.env }) => {
  const env = { ...baseEnv };
  for (const key of managedEnvKeys(config)) delete env[key];
  return env;
};

const portIsAvailable = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => resolve(error.code === "EPERM" || error.code === "EACCES"));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });

const pickPort = async (range, claims, portAvailable) => {
  const [start, end] = range;
  for (let port = start; port <= end; port += 1) {
    if (claims.has(port)) continue;
    if (!(await portAvailable(port))) continue;
    claims.add(port);
    return port;
  }
  throw new Error(`No available port in range ${start}-${end}`);
};

const existingOrPickedPort = async (existingEnv, claims, key, range, portAvailable) => {
  const port = Number(existingEnv[key]);
  if (Number.isInteger(port)) {
    claims.add(port);
    return port;
  }
  return await pickPort(range, claims, portAvailable);
};

export const buildRootEnv = async ({
  config,
  existingEnv = {},
  claimedPorts = new Set(),
  branchName,
  rootDir = process.cwd(),
  portAvailable = portIsAvailable,
}) => {
  const env = { ...existingEnv };
  const slug = slugify(branchName);
  const projectName = config.projectName ?? path.basename(rootDir);

  for (const [key, range] of Object.entries(config.ports ?? {})) {
    env[key] = String(await existingOrPickedPort(env, claimedPorts, key, range, portAvailable));
  }

  for (const [key, value] of Object.entries(config.env ?? {})) {
    env[key] = String(
      typeof value === "function" ? value({ env, config, projectName, slug, branchName, rootDir }) : value,
    );
  }

  return env;
};

const randomBase64Url = (length) => randomBytes(length).toString("base64url");

const resolveDefault = (value) => {
  if (value && typeof value === "object" && Number.isInteger(value.randomBase64Url)) {
    return randomBase64Url(value.randomBase64Url);
  }
  if (typeof value === "function") return value();
  return value;
};

export const withDatabaseName = (databaseUrl, databaseName) => {
  if (!databaseName) return databaseUrl;
  try {
    const url = new URL(databaseUrl);
    url.pathname = `/${databaseName}`;
    return url.toString();
  } catch {
    return databaseUrl;
  }
};

export const withDatabasePort = (databaseUrl, postgresPort, fallback) => {
  if (!databaseUrl) return fallback;
  try {
    const url = new URL(databaseUrl);
    url.hostname = "localhost";
    url.port = postgresPort;
    return url.toString();
  } catch {
    return fallback;
  }
};

export const applyEnvFileSpec = async ({ currentEnv = {}, rootEnv, spec }) => {
  const next = { ...currentEnv };

  for (const key of asArray(spec.remove)) delete next[key];

  for (const key of asArray(spec.sync)) {
    if (rootEnv[key] !== undefined) next[key] = rootEnv[key];
  }

  if (spec.databaseUrl) {
    const key = spec.databaseUrl.key ?? "DATABASE_URL";
    const port = rootEnv[spec.databaseUrl.portKey];
    const fallback = withDatabaseName(rootEnv[key], spec.databaseUrl.databaseName);
    const source = currentEnv[key] || next[key] || fallback;
    next[key] = withDatabasePort(withDatabaseName(source, spec.databaseUrl.databaseName), port, fallback);
  }

  for (const [key, value] of Object.entries(spec.defaults ?? {})) {
    if (next[key] === undefined || next[key] === "") next[key] = String(resolveDefault(value));
  }

  return next;
};

const gitOutput = (args, cwd, config = {}) =>
  run("git", args, { cwd, stdio: "pipe", config }).stdout.trim();

const gitRoot = (cwd, config) => gitOutput(["rev-parse", "--show-toplevel"], cwd, config);
const currentBranch = (cwd, config) => gitOutput(["rev-parse", "--abbrev-ref", "HEAD"], cwd, config);

const normalizeConfig = (config) => ({
  worktreeDir: DEFAULT_WORKTREE_DIR,
  envFile: DEFAULT_ENV_FILE,
  envFiles: [],
  hooks: {},
  ...config,
});

const loadConfig = async (rootDir) => {
  const configPath = process.env.DEV_CONFIG
    ? path.resolve(rootDir, process.env.DEV_CONFIG)
    : path.join(rootDir, DEFAULT_CONFIG_FILE);

  if (!existsSync(configPath)) {
    throw new Error(`Missing ${DEFAULT_CONFIG_FILE}. Copy and adapt the toolbox/dev example config.`);
  }

  const module = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`);
  return normalizeConfig(module.default ?? module.config ?? {});
};

export const mainCheckoutRoot = (rootDir, worktreeDir = DEFAULT_WORKTREE_DIR) => {
  const parent = path.dirname(rootDir);
  return path.basename(parent) === worktreeDir ? path.dirname(parent) : rootDir;
};

export const worktreeSlugsFromPorcelain = (
  porcelain,
  checkoutRoot,
  worktreeDir = DEFAULT_WORKTREE_DIR,
) => {
  const worktreesRoot = path.join(checkoutRoot, worktreeDir);
  return porcelain
    .split(/\r?\n/)
    .flatMap((line) => {
      if (!line.startsWith("worktree ")) return [];

      const worktreePath = line.slice("worktree ".length);
      const relativePath = path.relative(worktreesRoot, worktreePath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || relativePath === "") {
        return [];
      }

      return [relativePath.split(path.sep)[0]];
    });
};

const claimedPorts = async (rootDir, currentEnvPath, config) => {
  const checkoutRoot = mainCheckoutRoot(rootDir, config.worktreeDir);
  const envPaths = [path.join(checkoutRoot, config.envFile)];
  const worktreesPath = path.join(checkoutRoot, config.worktreeDir);

  try {
    const entries = await fs.readdir(worktreesPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) envPaths.push(path.join(worktreesPath, entry.name, config.envFile));
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const ports = new Set();
  for (const envPath of envPaths) {
    if (path.resolve(envPath) === path.resolve(currentEnvPath)) continue;
    const env = await readEnv(envPath);
    for (const key of Object.keys(config.ports ?? {})) {
      const port = Number(env[key]);
      if (Number.isInteger(port)) ports.add(port);
    }
  }
  return ports;
};

const syncEnvFiles = async (rootDir, rootEnv, config) => {
  for (const spec of config.envFiles) {
    if (!spec.path || spec.source === "managed-root") continue;

    const filePath = path.join(rootDir, spec.path);
    const currentEnv = await readEnv(filePath);
    const nextEnv = await applyEnvFileSpec({ currentEnv, rootEnv, spec });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeEnv(filePath, nextEnv);
  }
};

const run = (command, args = [], { cwd, stdio = "inherit", check = true, config = {} } = {}) => {
  const result = Array.isArray(command)
    ? spawnSync(command[0], command.slice(1), {
        cwd,
        stdio,
        encoding: "utf8",
        env: commandEnv({ config }),
      })
    : args.length > 0
      ? spawnSync(command, args, { cwd, stdio, encoding: "utf8", env: commandEnv({ config }) })
      : spawnSync(command, { cwd, stdio, encoding: "utf8", shell: true, env: commandEnv({ config }) });

  if (check && result.status !== 0) {
    const rendered = Array.isArray(command) ? command.join(" ") : [command, ...args].join(" ");
    throw new Error(`${rendered} failed with exit code ${result.status}`);
  }
  return result;
};

const runHooks = (hookName, cwd, config) => {
  for (const hook of asArray(config.hooks?.[hookName])) run(hook, [], { cwd, config });
};

const prepareCheckout = async (cwd, branchName, hookName) => {
  const rootDir = gitRoot(cwd);
  const config = await loadConfig(rootDir);
  const envPath = path.join(rootDir, config.envFile);
  const existingEnv = await readEnv(envPath);
  const rootEnv = await buildRootEnv({
    config,
    existingEnv,
    claimedPorts: await claimedPorts(rootDir, envPath, config),
    branchName: branchName ?? currentBranch(rootDir, config),
    rootDir,
  });

  await writeEnv(envPath, rootEnv);
  await syncEnvFiles(rootDir, rootEnv, config);
  runHooks(hookName, rootDir, config);

  console.log(`${config.envFile}: ${rootEnv.COMPOSE_PROJECT_NAME ?? slugify(branchName ?? currentBranch(rootDir, config))}`);
  for (const [key, value] of Object.entries(rootEnv)) {
    if (key.endsWith("_PORT") || key === "PORT" || key.endsWith("_URL") || key === "BASE_URL") {
      console.log(`${key}: ${value}`);
    }
  }
};

const copyEnvFiles = async (sourceRoot, targetRoot, config) => {
  for (const spec of config.envFiles) {
    if (!spec.path || spec.copyOnCreate === false || spec.source === "managed-root") continue;

    const sourcePath = path.join(sourceRoot, spec.path);
    const targetPath = path.join(targetRoot, spec.path);
    if (existsSync(sourcePath) && !existsSync(targetPath)) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    }
  }
};

const createWorktree = async (branchName, cwd) => {
  const rootDir = gitRoot(cwd);
  const config = await loadConfig(rootDir);
  const checkoutRoot = mainCheckoutRoot(rootDir, config.worktreeDir);

  const ignored = run("git", ["check-ignore", "-q", config.worktreeDir], {
    cwd: checkoutRoot,
    check: false,
    stdio: "ignore",
    config,
  });
  if (ignored.status !== 0) {
    throw new Error(`${config.worktreeDir}/ must be ignored before creating project-local worktrees`);
  }

  const worktreePath = path.join(checkoutRoot, config.worktreeDir, slugify(branchName));
  if (existsSync(worktreePath)) throw new Error(`Worktree path already exists: ${worktreePath}`);

  await fs.mkdir(path.join(checkoutRoot, config.worktreeDir), { recursive: true });

  const branchExists =
    run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
      cwd: rootDir,
      check: false,
      stdio: "ignore",
      config,
    }).status === 0;
  const args = branchExists
    ? ["worktree", "add", worktreePath, branchName]
    : ["worktree", "add", worktreePath, "-b", branchName];

  run("git", args, { cwd: rootDir, config });
  await copyEnvFiles(rootDir, worktreePath, config);
  await prepareCheckout(worktreePath, branchName, "afterCreate");
  console.log(`Worktree ready: ${worktreePath}`);
};

const removeWorktree = async (worktreeName, cwd, { force = false } = {}) => {
  const rootDir = gitRoot(cwd);
  const config = await loadConfig(rootDir);
  const checkoutRoot = mainCheckoutRoot(rootDir, config.worktreeDir);
  const worktreePath = path.join(checkoutRoot, config.worktreeDir, slugify(worktreeName));

  if (!existsSync(worktreePath)) throw new Error(`Worktree path does not exist: ${worktreePath}`);
  if (path.resolve(worktreePath) === path.resolve(rootDir)) throw new Error("Cannot remove the current checkout");

  const status = gitOutput(["status", "--porcelain"], worktreePath, config);
  if (status && !force) throw new Error(`Worktree has uncommitted changes: ${worktreePath}`);

  runHooks("beforeRemove", worktreePath, config);
  run("git", ["worktree", "remove", ...(force ? ["--force"] : []), worktreePath], {
    cwd: checkoutRoot,
    config,
  });
  console.log(`Worktree removed: ${worktreePath}`);
};

const listWorktreeSlugs = async (cwd) => {
  const rootDir = gitRoot(cwd);
  const config = await loadConfig(rootDir);
  const checkoutRoot = mainCheckoutRoot(rootDir, config.worktreeDir);
  const porcelain = gitOutput(["worktree", "list", "--porcelain"], checkoutRoot, config);
  for (const slug of worktreeSlugsFromPorcelain(porcelain, checkoutRoot, config.worktreeDir)) {
    console.log(slug);
  }
};

const main = async () => {
  const [, , command, ...args] = process.argv;

  if (command === "init" && args.length === 0) {
    await prepareCheckout(process.cwd(), undefined, "afterInit");
  } else if (command === "create" && args.length === 1) {
    await createWorktree(args[0], process.cwd());
  } else if ((command === "remove" || command === "rm") && (args.length === 1 || (args.length === 2 && args[1] === "--force"))) {
    await removeWorktree(args[0], process.cwd(), { force: args[1] === "--force" });
  } else if (command === "list" && args.length === 0) {
    await listWorktreeSlugs(process.cwd());
  } else {
    throw new Error(
      "Usage: dev <init|create|list|remove|rm> [...\n" +
        "  dev init\n" +
        "  dev create <branch>\n" +
        "  dev list\n" +
        "  dev remove <branch-or-slug> [--force]",
    );
  }
};

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
