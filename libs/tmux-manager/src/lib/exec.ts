import { exec as execCb, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

export const exec = promisify(execCb);
export const execFile = promisify(execFileCb);
