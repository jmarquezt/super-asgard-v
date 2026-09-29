import {inject, Injectable, signal} from '@angular/core';
import {LogEntry, LogEntryType} from '../core/models/asg.models';
import {AsgConfigService} from '../core/services/asg.config';

@Injectable({ providedIn: 'root' })
export class LogService {

  public eventLog = signal<LogEntry[]>([]);

  private readonly MAX_LOG_SIZE = 1000;
  private pendingLogs: LogEntry[] = [];
  private inCycleExecution = false;

  private configService = inject(AsgConfigService);

  private shouldLog(type: LogEntryType): boolean {
    const { loggingEnabled, logLevel } = this.configService.getCurrentConfig();
    if (!loggingEnabled) return false;
    if (logLevel === 'error')    return type === 'error';
    if (logLevel === 'warning')  return type === 'error' || type === 'warning';
    if (logLevel === 'relevant') return type === 'error' || type === 'success';
    return true; // 'debug': log everything
  }

  log(message: string, type: LogEntryType, cycle: number): void {
    if (!this.shouldLog(type)) return;
    const timestamp = Date.now();
    const entry: LogEntry = { cycle, message, type, timestamp };
    if (this.inCycleExecution) {
      this.pendingLogs.push(entry);
    } else {
      this.eventLog.update(logs => {
        const combined = [entry, ...logs];
        return combined.length > this.MAX_LOG_SIZE ? combined.slice(0, this.MAX_LOG_SIZE) : combined;
      });
    }
  }

  beginCycle(): void {
    this.inCycleExecution = true;
  }

  flushLogs(): void {
    if (this.pendingLogs.length > 0) {
      const toAdd = this.pendingLogs.reverse();
      this.pendingLogs = [];
      this.eventLog.update(logs => {
        const combined = [...toAdd, ...logs];
        return combined.length > this.MAX_LOG_SIZE ? combined.slice(0, this.MAX_LOG_SIZE) : combined;
      });
    }
    this.inCycleExecution = false;
  }

  clearLog(): void {
    this.eventLog.set([]);
  }

  reset(): void {
    this.clearLog();
    this.pendingLogs = [];
    this.inCycleExecution = false;
  }
}
