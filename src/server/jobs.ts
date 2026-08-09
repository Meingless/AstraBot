import { log } from "./observability.js";

export interface JobScheduler {
  recurring(name: string, intervalMs: number, job: () => void | Promise<void>): void;
  stop(): void;
}

export class InProcessJobScheduler implements JobScheduler {
  private timers: NodeJS.Timeout[] = [];

  recurring(name: string, intervalMs: number, job: () => void | Promise<void>) {
    const run = () =>
      Promise.resolve().then(job).catch((error) =>
        log("error", "job_failed", {
          job: name,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    const timer = setInterval(run, intervalMs);
    timer.unref();
    this.timers.push(timer);
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }
}
