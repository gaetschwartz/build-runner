
import * as vscode from 'vscode';
export type DartFlutterCommand = "flutter" | "dart";

export function pubCommand(shellCommand: DartFlutterCommand): string[] {
  switch (shellCommand) {
    case "dart":
      return ["run"];
    case "flutter":
      return ["pub", "run"];
  }
}

export function command(shellCommand: DartFlutterCommand): string {
  switch (shellCommand) {
    case "dart":
      return batchCommand("dart");
    case "flutter":
      return settings.flutterPath ?? batchCommand("flutter");
  }
}

export const output = vscode.window.createOutputChannel("Build Runner");

const extensionID = "build-runner";
export const COMMANDS = {
  watch: `${extensionID}.watch`,
  build: `${extensionID}.build`,
  buildFilters: `${extensionID}.build_filters`,
};

const SETTINGS_KEYS = {
  commandToUse: "commandToUse",
  flutterPath: "flutterPath",
  inferCommandToUse: "inferCommandToUse",
  useDeleteConflictingOutputs: {
    build: "useDeleteConflictingOutputs.build",
    watch: "useDeleteConflictingOutputs.watch"
  },
};


export const deleteConflictingOutputsSuffix = "--delete-conflicting-outputs";


export const settings = {
  get config() { return vscode.workspace.getConfiguration(extensionID); },

  get commandToUse() { return this.config.get<DartFlutterCommand>(SETTINGS_KEYS.commandToUse, "flutter"); },
  setCommandToUse(cmd: DartFlutterCommand) { return this.config.update(SETTINGS_KEYS.commandToUse, cmd); },

  get doInferCommandToUse() { return this.config.get<boolean>(SETTINGS_KEYS.inferCommandToUse, true); },
  setDoInferCommandToUse(value: boolean) { return this.config.update(SETTINGS_KEYS.inferCommandToUse, value); },

  get flutterPath() {
    const p = this.config.get<string | undefined>(SETTINGS_KEYS.flutterPath);
    return p === "" ? undefined : p;
  },
  setFlutterPath(path: string) { if (path !== "") { return this.config.update(SETTINGS_KEYS.flutterPath, path); } },

  useDeleteConflictingOutputs: {
    get build() { return settings.config.get<boolean>(SETTINGS_KEYS.useDeleteConflictingOutputs.build, false); },
    get watch() { return settings.config.get<boolean>(SETTINGS_KEYS.useDeleteConflictingOutputs.watch, false); },
  }
};

export function log(s: any, show?: boolean) {
  console.log(s);
  output.appendLine(s);
  if (show === true) { output.show(); }
}
export const isWin32 = process.platform === "win32";
export const isLinux = process.platform === "linux";
const batchCommand = (cmd: string): string => isWin32 ? cmd + ".bat" : cmd;

export function inferProgress(text: string): number | undefined {
  // match progress like: [INFO] 34.6s elapsed, 327/343 actions completed.
  const match = text.match(/(\d+)\s*\/\s*(\d+)\s+actions\s+completed/);
  if (match) {
    const [, completed, total] = match;
    return 100 * parseInt(completed) / parseInt(total);
  }
}

export function add(a: number | undefined, b: number): number | undefined {
  if (a === undefined) { return undefined; }
  return a + b;
}