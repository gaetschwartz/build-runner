import cp = require('child_process');
import { isWin32 } from './utils';



export class ChildProcessWrapper {
  constructor(doLog: boolean) {
    this.doLog = doLog;
  }

  readonly doLog: boolean;

  execSync(command: string): string {
    console.log(`Executing ${command}`);
    return cp.execSync(command, { encoding: "utf-8" });
  }

  spawn(command: string, args: ReadonlyArray<string>, options: cp.SpawnOptionsWithoutStdio): cp.ChildProcessWithoutNullStreams {
    console.log(`Spawning ${command} ${args.join(" ")} with ${options}`);
    return cp.spawn(command, args, options);
  }

  getChildPID(process: cp.ChildProcessWithoutNullStreams | undefined): string | undefined {
    if (process === undefined) { return undefined; }
    const ppid = process.pid;
    if (ppid === undefined) {
      console.error("undefined ppid !");
      return undefined;
    }
    if (isWin32) {

      const res = cp.execSync(
        `(Get-WmiObject Win32_Process -Filter "ParentProcessID=${ppid}" | Select ProcessID, ProcessName | Where-Object {$_.ProcessName -eq 'dart.exe'} | Select-Object -first 1).ProcessId`,
        { encoding: "utf8", shell: "powershell.exe" }
      );
      console.log(parseInt(res));
      return res;
    } else {
      const res = this.execSync(`ps xao pid,ppid | grep "\d* ${ppid}"`);
      return res.split(' ')[0];
    }
  }


  killPid(pid: string): string {
    console.log("Killing PID " + pid);
    if (isWin32) {
      return this.execSync(`taskkill /F /PID ${pid}`);
    } else {
      return this.execSync(`kill -SIGINT ${pid}`);
    }
  }


}