import * as vscode from 'vscode';
import { BuildRunnerWatch } from './watch';
import p = require('path');
import fs = require('fs');
import cp = require('child_process');


type ShellCommands = "flutter" | "dart";

export function pubCommand(shellCommand: ShellCommands): string[] {
	switch (shellCommand) {
		case "dart":
			return ["run"];
		case "flutter":
			return ["pub", "run"];
	}
}

export function command(shellCommand: ShellCommands): string {
	switch (shellCommand) {
		case "dart":
			return batchCommand("dart");
		case "flutter":
			return settings.flutterPath ?? batchCommand("flutter");
	}
}

export const output = vscode.window.createOutputChannel("build_runner");
export const extensionID = "build-runner";
export const COMMANDS = {
	watch: `${extensionID}.watch`,
	build: `${extensionID}.build`,
	buildFilters: `${extensionID}.build_filters`,
};
export const settings = {
	get commandToUse() { return vscode.workspace.getConfiguration(extensionID).get<ShellCommands>("commandToUse", "flutter"); },
	setCommandToUse(cmd: ShellCommands) { return vscode.workspace.getConfiguration(extensionID).update("commandToUse", cmd); },

	get flutterPath() { return vscode.workspace.getConfiguration(extensionID).get<string | undefined>("flutterPath"); },
	setFlutterPath(path: string) { return vscode.workspace.getConfiguration(extensionID).update("flutterPath", path); },
};
export function log(s: any, show?: boolean) {
	console.log(s);
	output.appendLine(s);
	if (show === true) { output.show(); }
}
export const isWin32 = process.platform === "win32";
export const isLinux = process.platform === "linux";
const batchCommand = (cmd: string): string => isWin32 ? cmd + ".bat" : cmd;

export function activate(context: vscode.ExtensionContext) {

	const watch = new BuildRunnerWatch(context);
	watch.show();

	const watchBuildRunner = vscode.commands.registerCommand(COMMANDS.watch, async () => await watch.toggle());

	const activateBuilder = vscode.commands.registerCommand(COMMANDS.build, async () =>
		await buildRunnerBuild({ useFilters: false })
	);

	const activateFastBuilder = vscode.commands.registerCommand(COMMANDS.buildFilters, async () =>
		await buildRunnerBuild({ useFilters: true })
	);


	context.subscriptions.push(watchBuildRunner, activateBuilder, activateFastBuilder);
}

interface BuildRunnerOptions { useFilters: boolean }
async function buildRunnerBuild({ useFilters }: BuildRunnerOptions) {
	const config = vscode.workspace.getConfiguration(extensionID);
	const opts: vscode.ProgressOptions = { location: vscode.ProgressLocation.Notification };

	let cwd = getDartProjectPath();
	if (cwd === undefined) {
		const selectFolder = "Select folder";
		const res = await vscode.window.showInformationMessage("Failed to detect where to run build_runner.", selectFolder);
		if (res === selectFolder) {
			cwd = await queryFolder();
		}
	}

	if (cwd === undefined) { log('Failed to infer where to run build_runner.'); return; }
	console.log(`cwd=${cwd}`);

	const filters = useFilters ? getFilters(cwd) : null;

	const cmdToUse = settings.commandToUse;
	const cmd = command(cmdToUse);
	let args: string[] = [...pubCommand(cmdToUse), "build_runner", "build"];

	if (config.get("useDeleteConflictingOutputs.build") === true) { args.push("--delete-conflicting-outputs"); }
	filters?.forEach(f => {
		args.push("--build-filter");
		args.push(f);
	});


	await vscode.window.withProgress(opts, async (p, _token) => {
		p.report({ message: "Initializing ..." });
		await new Promise<void>(async (r) => {

			log(`Spawning \`${cmd} ${args.join(" ")}\` in \`${cwd}\``);

			const child = cp.spawn(
				cmd,
				args,
				{ cwd: cwd });

			let mergedErr = "";
			let lastOut: string;

			child.stdout.on('data', (data) => {
				lastOut = data.toString();
				console.log('stdout: ' + lastOut);
				p.report({ message: lastOut });
			});

			child.stderr.on('data', (data) => {
				console.log('stderr: ' + data.toString());
				mergedErr += data;
			});

			child.on("error", (err) => {
				console.error(err);
				r();
			});

			child.on('close', async (code) => {
				console.log("close: " + code);
				r();
				await vscode.window.showErrorMessage("Failed: " + mergedErr, "Close");

				if (code !== 0) {
					const path = process.env.PATH;
					if (isLinux && !path?.includes("flutter") && settings.flutterPath === undefined) {
						const selectFlutter = "Enter flutter path";
						const res = await vscode.window.showInformationMessage("Flutter doesn't seem to be in the path. You probably installed Flutter using snap.", selectFlutter);
						if (res === selectFlutter) {
							let path = await vscode.window.showInputBox({ prompt: "Enter Flutter's path (output of `flutter sdk-path`)" });
							if (path !== undefined) {
								if (!fs.existsSync(path)) { path += "/bin/flutter"; }
								if (fs.existsSync(path)) { await settings.setFlutterPath(path); } else { vscode.window.showErrorMessage("This doesn't seem to be a valid path!"); }
							}
						}
					}


					if (
						settings.commandToUse === "dart" &&
						(mergedErr.includes("Could not find a file") || mergedErr.includes("pubspec.yaml"))
					) {
						const switchToFlutter = "Switch to flutter";
						const res = await vscode.window.showInformationMessage("You seem to have an issue with dart, do you want to try to use flutter instead ?", switchToFlutter);
						if (res === switchToFlutter) {
							await settings.setCommandToUse("flutter");
							buildRunnerBuild({ useFilters: useFilters });
						}
					}
				} else {
					vscode.window.showInformationMessage(lastOut);
				}
			});
		});
	});
}

async function queryFolder(): Promise<string | undefined> {
	const folders = vscode.workspace.workspaceFolders;
	const defaultFolder = folders === undefined ? undefined : folders[0].uri;

	const folder = await vscode.window.showOpenDialog({
		defaultUri: defaultFolder,
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		title: "Select where to run build_runner",
		openLabel: "Select",
	});
	if (folder === undefined) { return undefined; }
	return folder[0].fsPath;
}

export function getFilters(projectPath: string | undefined): Array<string> | null {
	// The code you place here will be executed every time your command is executed
	const uri = vscode.window.activeTextEditor?.document.uri;
	const path = uri?.path;

	/// Guard against welcome screen
	const isWelcomeScreen = path === undefined;
	if (isWelcomeScreen) { return null; }

	/// Guard against untitled files
	const isUntitled = vscode.window.activeTextEditor?.document.isUntitled;
	if (isUntitled) { return []; }

	/// Guard against no workspace name
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri!);
	const workspaceName = workspaceFolder?.name;
	if (workspaceName !== undefined) { console.log(`workspaceName=${workspaceName}`); }

	/// Guard against no workspace path
	const workspacePath = workspaceFolder?.uri.path;
	if (workspacePath === undefined) { return []; }

	const relativePath = path!.replace(workspacePath!, "");
	const segments = relativePath!.split("/").filter((e) => e !== "");

	/// Guard against no top level folder
	const hasTopLevelFolder = segments.length > 1;
	if (!hasTopLevelFolder) { return []; }

	//	const topLevelProjectFolder = segments![0];
	//	const topLevelFolder = `${workspacePath}/${topLevelProjectFolder}`;
	const segmentsWithoutFilename = [...segments].slice(
		0,
		segments!.length - 1
	);
	const bottomLevelFolder = `${workspacePath}/${segmentsWithoutFilename.join(
		"/"
	)}`;
	const targetFile = path;

	/// Guard against common generated files
	const targetIsFreezed = targetFile?.endsWith(".freezed.dart");
	const targetIsGenerated = targetFile?.endsWith(".g.dart");
	if (targetIsFreezed || targetIsGenerated) { return [`${bottomLevelFolder}/**`]; }

	/// get parts
	const text = vscode.window.activeTextEditor?.document.getText();
	const parts = text
		?.match(/^part ['"].*['"];$/gm)
		?.map((e) => e.replace(/^part ['"]/, "").replace(/['"];$/, ""));

	const hasParts = !(
		parts === undefined ||
		parts === null ||
		parts?.length === 0
	);

	if (!hasParts) { return [`${bottomLevelFolder}/**`]; }

	const projPath = projectPath === undefined ? undefined : vscode.Uri.file(projectPath).path;
	const buildFilters = parts!.map((e) => `${bottomLevelFolder}/${e}`).map((e) => {
		const p = vscode.Uri.file(e).path;
		if (projPath === undefined) { return p; } else {
			const rel = p.replace(projPath, "");
			const rel2 = rel.startsWith("/") ? rel.slice(1) : rel;
			return rel2;
		}
	});

	return buildFilters;
}

export function getDartProjectPath(): string | undefined {
	// The code you place here will be executed every time your command is executed
	const document = vscode.window.activeTextEditor?.document;
	const uri = document?.uri;
	const path = uri?.path;

	console.log('document_path=' + path);

	const isWelcomeScreen = path === undefined;
	const isUntitled = document?.isUntitled;

	/// Guard against welcome screen
	/// Guard against untitled files
	if (isWelcomeScreen || isUntitled) {
		console.log(`isWelcomeScreen=${isWelcomeScreen}, isUntitled=${isUntitled}`);
		return undefined;
	}

	/// Guard against no workspace name
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri!);
	const workspaceName = workspaceFolder?.name;
	if (workspaceName !== undefined) { console.log(`workspaceName=${workspaceName}`); }

	/// Guard against no workspace path
	const workspacePath = workspaceFolder?.uri.path;
	if (workspacePath === undefined) {
		console.log("workspace has no path");
		return undefined;
	}

	console.log(`workspacePath=${workspacePath}`);

	const relativePath = path!.replace(workspacePath!, "");
	const segments = relativePath!.split("/").filter((e) => e !== "");
	segments.pop();

	console.log(`segments=${segments}`);

	const pubspecSuffix = 'pubspec.yaml';

	if (fs.existsSync(workspacePath! + pubspecSuffix)) { return workspacePath; }

	const walkSegments: string[] = [];
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		const projectPath = vscode.Uri.file(p.join(workspacePath, ...walkSegments));
		const pubspec = vscode.Uri.joinPath(projectPath, pubspecSuffix);
		console.log('Looking for ' + pubspec.fsPath);
		if (fs.existsSync(pubspec.fsPath)) { console.log('Found it!'); return projectPath.fsPath; }
		walkSegments.push(s);
	}
	return undefined;
}

export function deactivate() { }
