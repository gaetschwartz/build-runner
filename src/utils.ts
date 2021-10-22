
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

export const output = vscode.window.createOutputChannel("build_runner");

const extensionID = "build-runner";
export const COMMANDS = {
  watch: `${extensionID}.watch`,
  build: `${extensionID}.build`,
  buildFilters: `${extensionID}.build_filters`,
};

const SETTINGS_KEYS = {
  commandToUse: "commandToUse",
  flutterPath: "flutterPath",
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

