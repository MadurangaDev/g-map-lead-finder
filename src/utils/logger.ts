import readline from "readline";
import chalk from "chalk";
import { ProgressDashboard } from "./progressDashboard";

export type LogLevel = "info" | "warn" | "error" | "success";

const PREFIXES: Record<
  LogLevel,
  { text: string; color: (s: string) => string }
> = {
  info: { text: "[INFO]", color: chalk.cyan },
  warn: { text: "[WARN]", color: chalk.yellow },
  error: { text: "[ERROR]", color: chalk.red },
  success: { text: "[SUCCESS]", color: chalk.green },
};

export class Logger {
  private dashboard: ProgressDashboard | null = null;

  setDashboard(dashboard: ProgressDashboard | null) {
    this.dashboard = dashboard;
  }

  private write(level: LogLevel, message: string) {
    if (this.dashboard) {
      this.dashboard.erase();
    }

    const { text, color } = PREFIXES[level];
    process.stdout.write(`${color(text)} ${message}\n`);

    if (this.dashboard) {
      this.dashboard.render();
    }
  }

  info(message: string) {
    this.write("info", message);
  }

  warn(message: string) {
    this.write("warn", message);
  }

  error(message: string) {
    this.write("error", message);
  }

  success(message: string) {
    this.write("success", message);
  }
}

export const logger = new Logger();
