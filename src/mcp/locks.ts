import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as lockfile from "proper-lockfile";

import { McpError } from "./errors.js";

export type ReleaseFn = () => Promise<void>;

export class LockManager {
  private readonly inFlight = new Map<string, Promise<ReleaseFn>>();

  async acquire(root: string, collection: string): Promise<ReleaseFn> {
    if (this.inFlight.has(collection)) {
      throw new McpError(
        "BUSY",
        `conversion in progress for "${collection}"`,
        "retry shortly",
      );
    }
    const acquire = this.acquireOnDisk(root, collection);
    this.inFlight.set(collection, acquire);
    try {
      return await acquire;
    } finally {
      // Slot is released by the returned ReleaseFn below.
    }
  }

  private acquireOnDisk(root: string, collection: string): Promise<ReleaseFn> {
    return (async () => {
      const lockTarget = join(root, collection);
      mkdirSync(lockTarget, { recursive: true });
      let release: () => Promise<void>;
      try {
        release = await lockfile.lock(lockTarget, {
          retries: 0,
          stale: 30_000,
          realpath: false,
        });
      } catch (e) {
        this.inFlight.delete(collection);
        throw new McpError(
          "BUSY",
          `another docforge process holds the lock for "${collection}"`,
          "wait for it to finish or remove the .lock file",
        );
      }
      return async () => {
        try {
          await release();
        } finally {
          this.inFlight.delete(collection);
        }
      };
    })();
  }
}
