import { exec, execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { shell } from 'electron';
import type { AppSettings, DownloadItem } from '../../shared/types';
import { logger } from '../logger';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export function isArchive(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.tar.bz2')
  );
}

/**
 * Extracts a compressed archive into the specified destination folder.
 * Uses native `tar` (supported natively on Windows 10/11, macOS, and Linux)
 * with a fallback to PowerShell `Expand-Archive` on Windows for `.zip` files.
 */
export async function extractArchive(
  archivePath: string,
  destinationDir: string
): Promise<{ success: boolean; extractedPath: string; error?: string }> {
  if (!existsSync(archivePath)) {
    return { success: false, extractedPath: destinationDir, error: 'Archive file does not exist' };
  }
  if (!existsSync(destinationDir)) {
    mkdirSync(destinationDir, { recursive: true });
  }

  const isWindows = process.platform === 'win32';
  const lower = archivePath.toLowerCase();

  // Primary attempt: system tar
  try {
    await execFileAsync('tar', ['-xf', archivePath, '-C', destinationDir], { timeout: 120_000 });
    return { success: true, extractedPath: destinationDir };
  } catch (tarErr) {
    logger.warn({ err: tarErr, archivePath }, 'tar extraction failed or unavailable, checking fallback');
  }

  // Windows fallback for .zip files: PowerShell Expand-Archive
  if (isWindows && lower.endsWith('.zip')) {
    try {
      const escapedArchive = archivePath.replace(/"/g, '`"');
      const escapedDest = destinationDir.replace(/"/g, '`"');
      const script = `Expand-Archive -LiteralPath "${escapedArchive}" -DestinationPath "${escapedDest}" -Force`;
      await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 180_000 });
      return { success: true, extractedPath: destinationDir };
    } catch (psErr) {
      logger.error({ err: psErr, archivePath }, 'PowerShell Expand-Archive fallback failed');
      return { success: false, extractedPath: destinationDir, error: String(psErr) };
    }
  }

  return { success: false, extractedPath: destinationDir, error: 'No compatible extraction tool succeeded' };
}

/**
 * Runs a user-defined shell command with variable interpolation.
 * Supports {filePath}, {fileName}, {directory}, {category}, {fileSize}.
 */
export async function runCustomCommand(
  commandTemplate: string,
  variables: Record<string, string | number>
): Promise<{ success: boolean; output?: string; error?: string }> {
  let cmd = commandTemplate;
  for (const [key, val] of Object.entries(variables)) {
    cmd = cmd.split(`{${key}}`).join(String(val));
  }
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 30_000 });
    return { success: true, output: (stdout || stderr || '').trim().slice(0, 1000) };
  } catch (err) {
    logger.error({ err, command: cmd }, 'Custom post-download command failed');
    return { success: false, error: String(err) };
  }
}

/**
 * Orchestrates post-download automation rules (archive extraction and custom commands).
 */
export async function executePostDownloadAutomation(
  item: DownloadItem,
  settings: AppSettings
): Promise<void> {
  const auto = settings.automation;
  if (!auto || !item.filePath || !existsSync(item.filePath)) return;

  // 1. Archive Auto-Extraction
  if (auto.autoExtractArchives && isArchive(item.filePath)) {
    try {
      const baseName = item.fileName.replace(/\.(zip|tar\.gz|tgz|tar\.bz2|tar)$/i, '');
      const destDir = auto.extractToSubfolder ? join(item.directory, baseName) : item.directory;
      const result = await extractArchive(item.filePath, destDir);
      if (result.success) {
        logger.info({ id: item.id, destDir }, 'Post-download: auto-extracted archive successfully');
        if (auto.deleteArchiveAfterExtraction) {
          try {
            await shell.trashItem(item.filePath);
            logger.info({ id: item.id, file: item.filePath }, 'Post-download: moved extracted archive to trash');
          } catch (trashErr) {
            logger.warn({ err: trashErr }, 'Post-download: failed to trash archive file after extraction');
          }
        }
      }
    } catch (err) {
      logger.error({ err, id: item.id }, 'Post-download: archive extraction execution threw an error');
    }
  }

  // 2. Custom Command Execution
  if (auto.customCommand && auto.customCommand.trim().length > 0) {
    try {
      const vars = {
        filePath: item.filePath,
        fileName: item.fileName,
        directory: item.directory,
        category: item.category,
        fileSize: item.totalBytes ?? item.receivedBytes ?? 0,
      };
      const cmdResult = await runCustomCommand(auto.customCommand, vars);
      if (cmdResult.success) {
        logger.info({ id: item.id, output: cmdResult.output }, 'Post-download: executed custom command');
      }
    } catch (err) {
      logger.error({ err, id: item.id }, 'Post-download: custom command execution failed');
    }
  }
}
