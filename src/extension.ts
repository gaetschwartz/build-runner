import * as vscode from 'vscode';
import { command, COMMANDS, DartFlutterCommand, deleteConflictingOutputsSuffix, inferProgress, isLinux, log, output, pubCommand, settings } from './utils';
import { BuildRunnerWatch } from './watch';
import p = require('path');
import yaml = require('js-yaml');
import fs = require('fs');
import cp = require('child_process');

export function activate(context: vscode.ExtensionContext) {
	const watch = new BuildRunnerWatch(context);
	watch.show();

	const watchBuildRunner = vscode.commands.registerCommand(COMMANDS.watch, async () =>
		await watch.toggle()
	);

	const activateBuilder = vscode.commands.registerCommand(COMMANDS.build, async () =>
		await buildRunnerBuild({ useFilters: false })
	);

	const activateFastBuilder = vscode.commands.registerCommand(COMMANDS.buildFilters, async () =>
		await buildRunnerBuild({ useFilters: true })
	);

	context.subscriptions.push(watchBuildRunner, activateBuilder, activateFastBuilder);
}

async function buildRunnerBuild(opt: { useFilters: boolean }) {
	const opts: vscode.ProgressOptions = { location: vscode.ProgressLocation.Notification };
	output.clear();
	let cwd = getDartProjectPath();
	if (cwd === undefined) {
		const selectFolder = "Select folder";
		const res = await vscode.window.showInformationMessage("Failed to detect where to run build_runner.", selectFolder);
		if (res === selectFolder) {
			cwd = await queryFolder();
		}
	}

	if (cwd === undefined) { log('Failed to infer where to run build_runner.', true); return; }
	console.log(`cwd=${cwd}`);

	const filters = opt.useFilters ? getFilters(cwd) : null;

	const cmdToUse = getCommandFromPubspec(cwd) || settings.commandToUse;
	const cmd = command(cmdToUse);
	let args: string[] = [...pubCommand(cmdToUse), "build_runner", "build"];

	if (settings.useDeleteConflictingOutputs.build) { args.push(deleteConflictingOutputsSuffix); }
	filters?.forEach(f => {
		args.push("--build-filter");
		args.push(f);
	});


	await vscode.window.withProgress(opts, async (p, _token) => {
		p.report({ message: "Starting build ..." });
		let progress = 0;
		let hasDoneSetup = false;
		await new Promise<void>(async (r) => {

			log(`Running \`${cmd} ${args.join(" ")}\``);
			log(`Current working folder: \`${cwd}\`\n`);

			const child = cp.spawn(
				cmd,
				args,
				{ cwd: cwd },
			);

			let mergedErr = "";
			let lastOut: string;

			child.stdout.on('data', (data) => {
				lastOut = data.toString();
				console.log('stdout: ' + lastOut);
				const prog = inferProgress(lastOut);
				let delta = prog === undefined ? undefined : prog - progress;
				if (prog !== undefined) {
					if (!hasDoneSetup) {
						hasDoneSetup = true;
						if (delta !== undefined) { delta += 5; }
					}
					progress = prog;
				}
				p.report({ message: lastOut, increment: delta });
				output.append(lastOut);
			});

			child.stderr.on('data', (data) => {
				console.log('stderr: ' + data.toString());
				output.append(data.toString());
				mergedErr += data;
			});

			child.on("error", (err) => {
				console.error(err);
				output.append(err.toString());
				r();
			});

			child.on('close', async (code) => {
				console.log("close: " + code);
				r();

				if (code !== 0) {
					let showError = true;
					if (isLinux && mergedErr === "" && (settings.commandToUse === "flutter" && settings.flutterPath === undefined)) {
						showError = false;
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
							buildRunnerBuild(opt);
						}
					}

					if (showError) {
						output.show();
						await vscode.window.showErrorMessage("Build failed. See output for details.");
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

	const relativePath = path!.replace(RegExp(workspacePath, "i")!, "");
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
			const rel = p.replace(new RegExp(projPath, "i"), "");
			const rel2 = rel.startsWith("/") ? rel.slice(1) : rel;
			return rel2;
		}
	});

	return buildFilters;
}

export function getCommandFromPubspec(path: string | undefined): DartFlutterCommand | undefined {
	if (!settings.doInferCommandToUse || path === undefined) { return undefined; }

	try {
		// Load the pubspec.yaml file
		const doc: any = yaml.load(fs.readFileSync(p.join(path, "pubspec.yaml"), 'utf8'));
		if (doc.dependencies?.flutter?.sdk === 'flutter') {
			// return flutter if the flutter sdk is set in the pubspec.yaml
			return 'flutter';
		}
		return 'dart';
	} catch (e) {
		console.log(e);
		return undefined;
	}
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

	const walkSegments: string[] = [...segments];
	for (let i = walkSegments.length; i >= 0; i--) {
		const projectPath = vscode.Uri.file(p.join(workspacePath, ...walkSegments));
		const pubspec = vscode.Uri.joinPath(projectPath, pubspecSuffix);
		console.log('Looking for ' + pubspec.fsPath);
		if (fs.existsSync(pubspec.fsPath)) { console.log('Found it!'); return projectPath.fsPath; }
		walkSegments.pop();
	}
	return undefined;
}

export function deactivate() { }



