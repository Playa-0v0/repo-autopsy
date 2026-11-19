import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * 用 Windows 自带的文件夹选择器挑一个目录。
 * 浏览器拿不到绝对路径，所以这一步只能由本地服务弹窗。
 */
const SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'None'
$owner.WindowState = 'Minimized'
$owner.Show()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择要分析的 Git 仓库'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog($owner) -eq 'OK') { Write-Output $dialog.SelectedPath }
$owner.Close()
`;

export async function pickFolder(): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("系统选择器目前只支持 Windows，其他系统请手动输入仓库路径");
  }

  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-STA", "-Command", SCRIPT], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5 * 60 * 1000,
    maxBuffer: 1024 * 1024,
  });

  return stdout.trim();
}
