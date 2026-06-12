/**
 * pi-esr/domain-pack — External filesystem pack loader
 *
 * Scans configurable directories for ESRDomainPack modules
 * and registers them into the pack registry at runtime.
 *
 * Pack directories are discovered via:
 *   1. ESR_PACKS_PATH env var (colon-separated, like PATH)
 *   2. ~/.pi-esr/packs/ (default)
 *
 * Each subdirectory must contain an index.js that exports
 * an object satisfying the ESRDomainPack interface.
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ESRDomainPackRegistry } from "./registry.js";
import type { ESRDomainPack } from "./types.js";

// ── Types ────────────────────────────────────────────────

export interface PackLoadResult {
  /** Pack names that were successfully loaded (e.g. "my-pack@0.1.0") */
  loaded: string[];
  /** Directories skipped (not packs, no index.js, no valid export) */
  skipped: string[];
  /** Errors encountered during load (non-fatal) */
  errors: string[];
}

// ── Config ────────────────────────────────────────────────

const DEFAULT_PACKS_PATH = join(homedir(), ".pi-esr", "packs");

function getPacksPaths(): string[] {
  const envPath = process.env.ESR_PACKS_PATH;
  if (envPath) {
    return envPath
      .split(":")
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return [DEFAULT_PACKS_PATH];
}

// ── Validation ────────────────────────────────────────────

function isESRDomainPack(obj: unknown): obj is ESRDomainPack {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    typeof o.version === "string" &&
    typeof o.detect === "function" &&
    typeof o.expand === "function" &&
    typeof o.validate === "function"
  );
}

function findPackExport(
  mod: Record<string, unknown>,
): ESRDomainPack | null {
  for (const value of Object.values(mod)) {
    if (isESRDomainPack(value)) return value;
  }
  return null;
}

// ── Configuration helpers ─────────────────────────────────

/** Resolved paths where packs are searched. */
export function getResolvedPacksPaths(): string[] {
  return getPacksPaths();
}

/** Ensure the default packs directory exists (useful for first-run setup). */
export function ensureDefaultPacksDir(): string {
  const dir = DEFAULT_PACKS_PATH;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ── Loader ────────────────────────────────────────────────

/**
 * Scan all configured packs paths and register discovered packs
 * into the given registry. Non-fatal errors are collected, not thrown.
 */
export async function loadExternalPacks(
  registry: ESRDomainPackRegistry,
): Promise<PackLoadResult> {
  const result: PackLoadResult = { loaded: [], skipped: [], errors: [] };

  for (const basePath of getPacksPaths()) {
    if (!existsSync(basePath)) continue;

    let entries: string[];
    try {
      // Use string[] paths to avoid Node.js Dirent type variance
      entries = readdirSync(basePath, { withFileTypes: true })
        .filter((de) => de.isDirectory())
        .map((de) => de.name as string);
    } catch (err) {
      result.errors.push(
        `Cannot list ${basePath}: ${(err as Error).message}`,
      );
      continue;
    }

    for (const dirName of entries) {
      const packDir = resolve(basePath, dirName);
      const indexPath = join(packDir, "index.js");

      if (!existsSync(indexPath)) {
        result.skipped.push(`${dirName}: no index.js`);
        continue;
      }

      try {
        const url = pathToFileURL(indexPath).href;
        const mod = (await import(url)) as Record<string, unknown>;
        const pack = findPackExport(mod);

        if (!pack) {
          result.skipped.push(
            `${dirName}: no ESRDomainPack export found`,
          );
          continue;
        }

        registry.register(pack);
        result.loaded.push(`${pack.name}@${pack.version} (${dirName})`);
      } catch (err) {
        result.errors.push(`${dirName}: ${(err as Error).message}`);
      }
    }
  }

  return result;
}
