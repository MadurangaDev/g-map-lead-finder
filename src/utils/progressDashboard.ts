import readline from "readline";
import chalk from "chalk";

export interface DashboardMetrics {
  total: number;
  processed: number;
  saved: number;
  skipped: number;
  errors: number;
  startTime: number;
  currentTask?: string;
}

export interface DashboardRenderOptions {
  formatRate?: (rate: number) => string;
  formatETA?: (etaSeconds: number) => string;
  formatNumber?: (n: number) => string;
}

const DASH_LINE = "\u2500".repeat(48);

function renderProgressBar(ratio: number, width = 20): string {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

export class ProgressDashboard {
  private metrics: DashboardMetrics;
  private lineCount = 0;
  private readonly renderOptions: Required<DashboardRenderOptions>;

  constructor(
    initial: Partial<DashboardMetrics>,
    renderOptions: DashboardRenderOptions = {},
  ) {
    this.metrics = {
      total: 0,
      processed: 0,
      saved: 0,
      skipped: 0,
      errors: 0,
      startTime: Date.now(),
      ...initial,
    };
    this.renderOptions = {
      formatRate:
        renderOptions.formatRate ?? ((rate) => `${(rate*60).toFixed(2)} tasks/min`),
      formatETA: renderOptions.formatETA ?? formatETA,
      formatNumber: renderOptions.formatNumber ?? ((n) => n.toLocaleString()),
    };
  }

  update(partial: Partial<DashboardMetrics>) {
    Object.assign(this.metrics, partial);
  }

  erase() {
    if (this.lineCount > 0) {
      readline.moveCursor(process.stdout, 0, -this.lineCount);
      readline.clearScreenDown(process.stdout);
      this.lineCount = 0;
    }
  }

  render() {
    if (this.lineCount > 0) {
      readline.moveCursor(process.stdout, 0, -this.lineCount);
    }
    readline.clearScreenDown(process.stdout);

    const lines = this.computeLines();
    process.stdout.write(lines.join("\n") + "\n");
    this.lineCount = lines.length;
  }

  getSummary() {
    const elapsed = (Date.now() - this.metrics.startTime) / 1000;
    const successCount = this.metrics.processed - this.metrics.errors;

    return {
      totalTasks: this.metrics.total,
      successfulTasks: successCount,
      failedTasks: this.metrics.errors,
      savedLeads: this.metrics.saved,
      skipped: this.metrics.skipped,
      errors: this.metrics.errors,
      duration: formatDuration(elapsed),
    };
  }

  private computeLines(): string[] {
    const { total, processed, saved, skipped, errors, startTime, currentTask } =
      this.metrics;
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = elapsed > 0 ? processed / elapsed : 0;
    const progress = total > 0 ? (processed / total) * 100 : 0;
    const eta = rate > 0 ? (total - processed) / rate : 0;

    const formatNumber = this.renderOptions.formatNumber;
    const formatRate = this.renderOptions.formatRate;
    const formatETA = this.renderOptions.formatETA;

    const bar = renderProgressBar(progress / 100);

    return [
      "",
      DASH_LINE,
      "",
      `${chalk.cyan("Progress:")} ${chalk.green(bar)} ${progress.toFixed(1)}%`,
      `${chalk.cyan("Current:")} ${currentTask || "-"}`,
      `Processed: ${formatNumber(processed)} / ${formatNumber(total)}`,
      "",
      `${chalk.green("Saved:")} ${formatNumber(saved)}`,
      `${chalk.yellow("Skipped:")} ${formatNumber(skipped)}`,
      `${chalk.red("Errors:")} ${formatNumber(errors)}`,
      "",
      `Rate: ${formatRate(rate)}`,
      `${chalk.blue("ETA:")} ${formatETA(eta)}`,
      `Elapsed: ${formatDuration(elapsed)}`,
    ];
  }
}

function formatETA(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return "--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return "0s";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}h ${mins}m ${secs}s`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}
