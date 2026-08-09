import { afterEach, describe, expect, it, vi } from "vitest";
import { InProcessJobScheduler } from "./jobs.js";

afterEach(() => vi.useRealTimers());

describe("in-process scheduler", () => {
  it("runs recurring work and stops all timers", async () => {
    vi.useFakeTimers();
    const scheduler = new InProcessJobScheduler();
    const job = vi.fn();
    scheduler.recurring("retention", 1_000, job);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(job).toHaveBeenCalledTimes(2);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(job).toHaveBeenCalledTimes(2);
  });

  it("contains and reports recurring job failures", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const scheduler = new InProcessJobScheduler();
    scheduler.recurring("failing-job", 100, () => {
      throw new Error("expected failure");
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"event":"job_failed"'));
    scheduler.stop();
    errors.mockRestore();
  });
});
