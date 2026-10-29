using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

internal static class DesktopHost {
  private delegate bool EnumProc(IntPtr hwnd, IntPtr extra);
  [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr extra);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr extra);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int length);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetStyle(IntPtr hwnd, int index);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] private static extern IntPtr SetStyle(IntPtr hwnd, int index, IntPtr style);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] private static extern int MapWindowPoints(IntPtr from, IntPtr to, ref Point point, uint count);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  private static string Class(IntPtr hwnd) { var text = new StringBuilder(256); GetClassName(hwnd, text, text.Capacity); return text.ToString(); }
  private static object Describe(IntPtr hwnd) {
    Rect rect; GetWindowRect(hwnd, out rect);
    return new { handle = hwnd.ToInt64().ToString(), parent = GetParent(hwnd).ToInt64().ToString(), cls = Class(hwnd), visible = IsWindowVisible(hwnd), x = rect.Left, y = rect.Top, width = rect.Right - rect.Left, height = rect.Bottom - rect.Top };
  }
  private static IntPtr IconsRoot(out IntPtr view) {
    IntPtr root = IntPtr.Zero, found = IntPtr.Zero;
    EnumWindows((hwnd, extra) => {
      var child = FindWindowEx(hwnd, IntPtr.Zero, "SHELLDLL_DefView", null);
      if (child == IntPtr.Zero) return true;
      root = hwnd; found = child; return false;
    }, IntPtr.Zero);
    view = found;
    return root;
  }
  private static int Main(string[] args) {
    try {
      try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) {}
      object output;
      if (args[0] == "inspect") {
        var windows = new List<object>();
        EnumWindows((hwnd, extra) => {
          if (Class(hwnd) == "Progman" || Class(hwnd) == "WorkerW") {
            windows.Add(Describe(hwnd));
            EnumChildWindows(hwnd, (child, unused) => { windows.Add(Describe(child)); return true; }, IntPtr.Zero);
          }
          return true;
        }, IntPtr.Zero);
        output = new { ok = true, windows = windows };
      } else if (args[0] == "point") {
        output = new { ok = true, window = Describe(WindowFromPoint(new Point { X = int.Parse(args[1]), Y = int.Parse(args[2]) })) };
      } else {
        var hwnd = new IntPtr(long.Parse(args[1]));
        uint pid; GetWindowThreadProcessId(hwnd, out pid);
        if (!IsWindow(hwnd) || pid != uint.Parse(args[2])) throw new Exception("Application window is no longer available.");
        try { SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(hwnd)); } catch (EntryPointNotFoundException) {}
        Rect rect; GetWindowRect(hwnd, out rect);
        long style = GetStyle(hwnd, -16).ToInt64(), extended = GetStyle(hwnd, -20).ToInt64();
        if (args[0] == "snapshot") {
          output = new { ok = true, originalStyle = style.ToString(), originalExtendedStyle = extended.ToString(), transparent = (extended & 0x20L) != 0, window = Describe(hwnd) };
        } else if (args[0] == "attach") {
          rect.Left = int.Parse(args[3]); rect.Top = int.Parse(args[4]);
          rect.Right = rect.Left + int.Parse(args[5]); rect.Bottom = rect.Top + int.Parse(args[6]);
          IntPtr view;
          var root = IconsRoot(out view);
          if (root == IntPtr.Zero) throw new Exception("Explorer desktop icon layer was not found.");
          var progman = FindWindow("Progman", null);
          IntPtr result;
          // Explorer creates a wallpaper host on classic and current Windows.
          SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 2, 500, out result);
          root = IconsRoot(out view);
          var worker = FindWindowEx(IntPtr.Zero, root, "WorkerW", null);
          // New Explorer versions keep WorkerW underneath Progman instead of
          // as a top-level sibling. Parent under the icon root in that layout.
          var modernWorker = FindWindowEx(root, IntPtr.Zero, "WorkerW", null);
          var parent = modernWorker != IntPtr.Zero ? root : worker == IntPtr.Zero ? root : worker;
          var after = parent == root ? view : IntPtr.Zero;
          var previousParent = GetParent(hwnd);
          try {
            SetStyle(hwnd, -16, new IntPtr((style | 0x40000000L | 0x04000000L) & ~0x80C40000L));
            SetStyle(hwnd, -20, new IntPtr((extended | 0x08000000L | 0x80L) & ~0x40000L));
            SetParent(hwnd, parent);
            if (GetParent(hwnd) != parent) throw new Exception("Explorer rejected desktop parenting.");
            var origin = new Point { X = rect.Left, Y = rect.Top };
            MapWindowPoints(IntPtr.Zero, parent, ref origin, 1);
            if (!SetWindowPos(hwnd, after, origin.X, origin.Y, rect.Right - rect.Left, rect.Bottom - rect.Top, 0x10 | 0x20 | 0x40)) throw new Exception("Desktop positioning failed.");
          } catch {
            SetStyle(hwnd, -16, new IntPtr(style)); SetStyle(hwnd, -20, new IntPtr(extended));
            SetParent(hwnd, previousParent);
            throw;
          }
          output = new { ok = true, parent = parent.ToInt64().ToString(), iconRoot = root.ToInt64().ToString(), iconView = view.ToInt64().ToString(), originalStyle = style.ToString(), originalExtendedStyle = extended.ToString(), layout = parent == root ? "shared-icon-root" : "wallpaper-worker", window = Describe(hwnd) };
        } else if (args[0] == "detach") {
          SetStyle(hwnd, -16, new IntPtr(long.Parse(args[3])));
          SetStyle(hwnd, -20, new IntPtr(long.Parse(args[4])));
          SetParent(hwnd, IntPtr.Zero);
          if (GetParent(hwnd) != IntPtr.Zero) throw new Exception("Desktop detachment failed: " + Marshal.GetLastWin32Error() + "; parent=" + GetParent(hwnd));
          SetWindowPos(hwnd, IntPtr.Zero, rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top, 0x10 | 0x20 | 0x40);
          output = new { ok = true, window = Describe(hwnd) };
        } else throw new Exception("Unknown desktop command.");
      }
      Console.WriteLine(new JavaScriptSerializer().Serialize(output));
      return 0;
    } catch (Exception error) {
      Console.WriteLine(new JavaScriptSerializer().Serialize(new { ok = false, error = error.Message }));
      return 1;
    }
  }
}
