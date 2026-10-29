using System;
using System.IO;
using System.Diagnostics;

internal static class UpdateHost {
  private static readonly object LogLock = new object();
  private static string logPath;

  private static void Log(string value) {
    if (value == null) return;
    lock (LogLock) File.AppendAllText(logPath, value + Environment.NewLine);
  }

  private static string Quote(string value) {
    return "\"" + value.Replace("\"", "\\\"") + "\"";
  }

  private static int Main(string[] args) {
    if (args.Length != 2) return 2;
    logPath = Path.Combine(Path.GetDirectoryName(args[1]), "helper-output.log");
    try {
      var info = new ProcessStartInfo {
        FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
        Arguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " + Quote(args[0]) + " -RequestPath " + Quote(args[1]),
        UseShellExecute = false,
        CreateNoWindow = true,
        WindowStyle = ProcessWindowStyle.Hidden,
        RedirectStandardOutput = true,
        RedirectStandardError = true
      };
      info.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
      using (var child = new Process { StartInfo = info }) {
        child.OutputDataReceived += (sender, item) => Log(item.Data);
        child.ErrorDataReceived += (sender, item) => Log(item.Data);
        child.Start();
        child.BeginOutputReadLine();
        child.BeginErrorReadLine();
        child.WaitForExit();
        return child.ExitCode;
      }
    } catch (Exception error) {
      Log(error.ToString());
      return 1;
    }
  }
}
