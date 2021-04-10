import cp = require('child_process');
import https = require('https');
import fs = require('fs');
import path = require('path');
import * as vscode from 'vscode';

const download = async (url: string, filePath: fs.PathLike) => {
  const file = fs.createWriteStream(filePath);

  await new Promise<void>((cb, rej) => {
    const req = https.get(url, async (resp) => {
      if (resp.statusCode !== undefined
        && resp.statusCode >= 300
        && resp.statusCode < 400
        && resp.headers.location !== undefined
      ) {
        var location = resp.headers.location!;
        console.log('Redirecting to', location);
        await download(location, filePath);
        cb();
      } else if (resp.statusCode === 200) {
        console.log('Piping response to', filePath);
        resp.pipe(file);
      } else {
        console.log('Response status was ' + resp.statusCode);
        rej(resp);
      }
    });

    // close() is async, call cb after close completes
    file.on('finish', () => {
      file.close();
      console.log(`Done fetching !`);
      cb();
    });

    // check for request error too
    file.on('error', async function (err) { // Handle errors
      console.error('Error while fetching', url, ':', err);
      await new Promise<void>((r) => fs.unlink(filePath, () => r()));
      console.log('Unlinked', path);
      rej(err);
    });

    req.on('error', async function (err) { // Handle errors
      console.error('Error while fetching SigintSender.exe:', err);
      await new Promise<void>((r) => fs.unlink(filePath, () => r()));
      console.log('Unlinked', path);
      rej(err);
    });
  });


};


export class SigintSender {
  constructor(context: vscode.ExtensionContext, url: string) {
    this.url = url;
    this.globalStoragePath = vscode.Uri.file(context.globalStoragePath).fsPath;
    this.filePath =
      path.join(this.globalStoragePath, "SigintSender.exe");
  }

  readonly url: string;
  readonly globalStoragePath: string;
  readonly filePath: string;

  async fetchBinary(): Promise<void> {
    if (!fs.existsSync(this.filePath)) {
      if (!fs.existsSync(this.globalStoragePath)) {
        console.log(`${this.globalStoragePath} doesn't exist, creating...`);
        fs.mkdirSync(this.globalStoragePath);
      }
      console.log('Fetching SigintSender.exe from ' + this.url);
      console.log(`And storing it to ${this.filePath}`);
      await download(this.url, this.filePath);
    }
  }
  async send(pid: string): Promise<void> {
    await this.fetchBinary();
    console.log(`Running \`${this.filePath} ${pid}\``);
    const out = cp.execSync(`${this.filePath} ${pid.toString()}`, { encoding: "utf-8" });
    console.log(out);
  }
}


