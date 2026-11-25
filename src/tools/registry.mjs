// How a session's hooks and its Copilot extension find the a2a-games MCP server of that session, after agent-room's
// registry. A server in a game keeps ~/.a2a-games/sessions/<pid>.json: { cliPid, pid, session, port }.
// It stays JavaScript, typed in JSDoc, because the Copilot extension imports it and Copilot loads extensions only as
// JavaScript.

/** @typedef {{ cliPid: number, pid: number, session?: string, port: number }} Entry */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), ".a2a-games", "sessions");
const mine = path.join(DIR, `${process.pid}.json`);

// Every process's parent, by process id.
/** @returns {Map<number, { ppid: number, command: string }>} */
function processes() {
  return new Map(
    execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
      .filter((match) => match !== null)
      .map(([, pid, ppid, command]) => [Number(pid), { ppid: Number(ppid), command }]),
  );
}

// This process's chain of parent process ids, nearest first.
export function parents() {
  const all = processes();
  const chain = [];
  for (let pid = process.ppid; pid > 1; pid = all.get(pid)?.ppid ?? 0) chain.push(pid);
  return chain;
}

// The program this server's session runs in. A version manager's node can be a wrapper process running the same
// script with the same arguments, so ancestors whose command ends that way are skipped.
function cliPid() {
  const script = ` ${process.argv.slice(1).join(" ")}`;
  const all = processes();
  let pid = process.ppid;
  for (let parent = all.get(pid); parent?.command.endsWith(script); parent = all.get(pid)) pid = parent.ppid;
  return pid > 1 ? pid : process.ppid;
}

// Written whole and renamed into place, so a reader never sees half a file.
/** @param {{ session?: string, port: number }} entry */
export function register(entry) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${mine}.tmp`, JSON.stringify({ cliPid: cliPid(), pid: process.pid, ...entry }));
  fs.renameSync(`${mine}.tmp`, mine);
}

export const unregister = () => fs.rmSync(mine, { force: true });

/** @param {number} pid */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The servers of sessions in a game on this machine. Files of servers that have ended are removed on the way.
/** @returns {Entry[]} */
export function open() {
  if (!fs.existsSync(DIR)) return [];
  /** @type {Entry[]} */
  const entries = [];
  for (const name of fs.readdirSync(DIR).filter((one) => one.endsWith(".json"))) {
    const file = path.join(DIR, name);
    const entry = JSON.parse(fs.readFileSync(file, "utf8"));
    if (isAlive(entry.pid)) entries.push(entry);
    else fs.rmSync(file, { force: true });
  }
  return entries;
}

// The server of a session: the one with that session id, or else the one filed under the nearest of `pids`, but only
// when it is the only one there. An editor can run many sessions in one process, and then the process can't say which.
/**
 * @param {Entry[]} entries
 * @param {number[]} pids
 * @param {string} [session]
 * @returns {Entry | null}
 */
export function sessionOf(entries, pids, session) {
  const same = session ? entries.find((one) => one.session === session) : undefined;
  if (same) return same;
  for (const pid of pids) {
    const there = entries.filter((one) => one.cliPid === pid);
    if (there.length) return there.length === 1 ? there[0] : null;
  }
  return null;
}

/**
 * @param {Entry} entry
 * @param {string} route
 * @param {number} ms
 * @returns {Promise<{ notice?: string | null, prompt?: string, again?: boolean }>} the answers the server's routes give
 */
export async function call(entry, route, ms) {
  const response = await fetch(`http://127.0.0.1:${entry.port}${route}`, { method: "POST", signal: AbortSignal.timeout(ms) });
  return /** @type {Promise<{ notice?: string | null, prompt?: string, again?: boolean }>} */ (response.json());
}
