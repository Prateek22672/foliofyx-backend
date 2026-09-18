// server/lib/domainMonitor.js
// Background re-checks for custom domains: pending ones on a backoff schedule
// (5 min → 6 h), live ones every 6 h (so removed DNS stops serving). Runs
// in-process, never overlaps itself and never keeps the process alive.

import CustomWebsite from "../models/CustomWebsite.js";
import { runDomainCheck, ACTIVE_STATUSES } from "./domainService.js";

const TICK_MS = 5 * 60_000;
const BATCH = 20;

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const due = await CustomWebsite.find({
      "customDomain.name": { $exists: true, $ne: null },
      "customDomain.status": { $in: ACTIVE_STATUSES },
      $or: [{ "customDomain.nextCheckAt": { $lte: now } }, { "customDomain.nextCheckAt": { $exists: false } }],
    })
      .sort({ "customDomain.nextCheckAt": 1 })
      .limit(BATCH);

    for (const site of due) {
      try {
        await runDomainCheck(site);
        await site.save();
      } catch (err) {
        console.warn(`[domain-monitor] ${site.customDomain?.name}:`, err.message);
      }
    }
    if (due.length) console.log(`[domain-monitor] re-checked ${due.length} domain(s)`);
  } catch (err) {
    console.warn("[domain-monitor] tick failed:", err.message);
  } finally {
    running = false;
  }
}

export function startDomainMonitor() {
  if (timer || process.env.DOMAIN_MONITOR === "off") return;
  timer = setInterval(tick, TICK_MS);
  timer.unref();
  setTimeout(tick, 30_000).unref();
}

export function stopDomainMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}
