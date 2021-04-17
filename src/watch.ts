import * as vscode from 'vscode';
import { computeCommandName, getDartProjectPath, isWin32, log, output } from './extension';
import { SigintSender } from './sigint';
import cp = require('child_process');

enum State { initializing, watching, idle, }

const timeout = <T>(prom: Promise<T>, time: number) =>
  Promise.race<T>([prom, new Promise<T>((_r, rej) => setTimeout(rej, time))]);

interface ExitData extends Object {
  code?: number | null;
  signal?: NodeJS.Signals | null;
}

const exitDataToString = (d: ExitData) => `{code: ${d.code}, signal: ${d.signal}}`;

export class BuildRunnerWatch {

  readonly sigintSender: SigintSender;

  constructor(context: vscode.ExtensionContext) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    this.statusBar.command = "build-runner.watch";
    this.statusBar.tooltip = "Watch with build_runner";
    this.statusBar.text = this.text();
    context.subscriptions.push(this.statusBar);



    this.sigintSender = new SigintSender(
      context,
      "https://github.com/gaetschwartz/SigintSender/releases/download/ci-deploy-8/SigintSender-x64-8.exe"
    );
  }

  state: State = State.idle;
  process: cp.ChildProcessWithoutNullStreams | undefined;

  readonly watchString = "$(eye) Watch";
  readonly loadingString = "$(loading~spin) Initializing";
  readonly removeWatchString = "$(eye-closed) Remove watch";

  readonly statusBar: vscode.StatusBarItem;

  show(): void {
    this.statusBar.show();
  }

  text(): string {
    switch (this.state) {
      case State.idle:
        return this.watchString;
      case State.watching:
        return this.removeWatchString;
      case State.initializing:
        return this.loadingString;
    }
  }

  setState(state: State): void {
    this.state = state;
    this.statusBar.text = this.text();
  }

  async toggle(): Promise<void> {
    switch (this.state) {
      case State.idle:
        output.show();
        return this.watch();
      case State.watching:
        output.show();
        return this.removeWatch();
      case State.initializing:
        break;
    }
  }

  async removeWatch(): Promise<void> {
    if (process !== undefined) {

      try {
        const exit = await timeout<ExitData>(new Promise(async (cb) => {
          this.process?.on('exit', (code, sgn) => cb({ signal: sgn, code: code }));
          // Try to submit 'y' to answer the dialog 'Terminate batch job (Y/N)? '.
          this.process?.stdin.write('y\n');
          await this.killWatch();
        }), 2500);

        console.log(`Exited successfully with: ${exitDataToString(exit)}`);

        if (exit.code === 0) {
          console.log('Success, cleaning...');
          this.process = undefined;
          output.appendLine("Stopped watching");
          this.setState(State.idle);
        }
      } catch (error) {
        vscode.window.showErrorMessage("Failed to remove the watch! Try again. If it still doesn't work try closing VSCode and reopening.", "Okay");
      }
    }
  }

  getChildPID(): string | undefined {
    if (this.process !== undefined) {
      const ppid = this.process!.pid;
      if (isWin32) {
        const res = cp.execSync(`wmic process where("ParentProcessId=${ppid}") get Caption,ProcessId`, {
          encoding: "utf8", shell: "powershell.exe",
        });
        //console.log(res);
        const match = res.match(/dart.exe\s+(\d+)/);
        console.log(match);
        if (match === null) {
          console.log('No matches');
          return undefined;
        }
        return match[1];
      } else {
        const res = cp.execSync(`ps xao pid,ppid | grep "\d* ${ppid}"`, { encoding: "utf8" });
        return res.split(' ')[0];
      }
    }
  }

  async killWatch(): Promise<void> {
    if (this.process !== undefined) {
      console.log('Going to try to kill the watch...');
      console.log('PID of parent is ' + this.process.pid);
      const pid = this.getChildPID()!;
      console.log('PID of actual process is ' + pid);
      if (isWin32) {
        await this.sigintSender.send(pid);
      } else {
        cp.spawnSync("kill", ["-SIGINT", `${pid}`]);
      }
    }
  }

  async queryProject(): Promise<vscode.Uri | undefined> {
    const choose = "Choose a folder";
    const res = await vscode.window.showInformationMessage("Failed to determine where to run the command. Please choose where to run it.", choose);
    if (res !== choose) { return undefined; }
    const uri = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false });
    if (uri === undefined) { return undefined; }
    return uri[0];
  }

  async watch(): Promise<void> {
    output.clear();

    if (isWin32) {
      const risk = "I take the risk.";
      const res = await vscode.window.showWarningMessage("Using `dart run build_runner watch` on Windows is broken for the moment. Starting it works fine but you won't be able quit the watch easily.", risk);
      if (res !== risk) { return; }
    }

    const config = vscode.workspace.getConfiguration('build-runner');
    let cwd = getDartProjectPath();

    if (cwd === undefined) {
      const uri = await this.queryProject();
      if (uri === undefined) { return; } else { cwd = uri.fsPath; }
    }

    console.log("cwd: " + cwd);

    const cmd = computeCommandName('dart');
    const args: string[] = ["run", "build_runner", "watch"];
    const opts: cp.SpawnOptionsWithoutStdio = { cwd: cwd };
    if (config.get("useDeleteConflictingOutputs.watch") === true) { args.push("--delete-conflicting-outputs"); }

    log(`Spawning \`${cmd} ${args.join(' ')}\` in ${opts.cwd}`);

    this.process = cp.spawn(cmd, args, opts);
    this.setState(State.initializing);

    console.log(`Started with PID: ${this.process!.pid}`);

    this.process.stdout.on('data', (data) => {
      const string = data.toString();
      console.log('stdout: ' + string);
      if (this.state !== State.watching) { this.setState(State.watching); }
      output.append(string);
    });

    this.process.stderr.on('data', (data) => {
      const err = data.toString();
      console.log('stderr: ' + err);
      output.append(err);
    });

    this.process.stdin.on('data', (data) => {
      const stdin = data.toString();
      console.log('stdin: ' + stdin);
    });

    this.process.on('error', (err) => { console.error(err); });
    this.process.on('message', (err) => { console.info('info:', err); });

    this.process.on('close', (code) => {
      console.log("close: " + code);

      if (code !== 0) {
        output.appendLine("\nCommand exited with code " + code);
        output.show();
      }

      // cleanup
      this.process = undefined;
      this.setState(State.idle);
    });
  }
}