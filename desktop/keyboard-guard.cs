using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class KeyboardGuard {
  private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] private struct KeyData { public uint Key, Scan, Flags, Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] private struct KeyboardInput { public ushort Key, Scan; public uint Flags, Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Explicit, Size = 32)] private struct InputData { [FieldOffset(0)] public KeyboardInput Keyboard; }
  [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public InputData Data; }
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int id, HookProc callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string module);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] private static extern uint SendInput(uint count, Input[] inputs, int size);
  private static readonly HookProc callback = Filter;
  private static readonly HashSet<uint> heldModifiers = new HashSet<uint>();
  private static readonly HashSet<uint> initialModifiers = new HashSet<uint>();
  private static readonly ConcurrentQueue<string> keys = new ConcurrentQueue<string>();
  private static readonly AutoResetEvent available = new AutoResetEvent(false);
  private static readonly Dictionary<uint, string> keypad = new Dictionary<uint, string> { { 0x52, "0" }, { 0x4F, "1" }, { 0x50, "2" }, { 0x51, "3" }, { 0x4B, "4" }, { 0x4C, "5" }, { 0x4D, "6" }, { 0x47, "7" }, { 0x48, "8" }, { 0x49, "9" } };
  private static IntPtr hook, window;
  private static volatile bool inputEnabled, stopping;
  private static long lastHeartbeat;
  private static bool Modifier(uint key) { return key == 0x10 || key == 0x11 || key == 0x12 || key == 0x5B || key == 0x5C || (key >= 0xA0 && key <= 0xA5); }
  private static IntPtr Filter(int code, IntPtr message, IntPtr data) {
    if (code < 0) return CallNextHookEx(hook, code, message, data);
    var key = (KeyData)Marshal.PtrToStructure(data, typeof(KeyData));
    bool down = message.ToInt64() == 0x100 || message.ToInt64() == 0x104;
    if (Modifier(key.Key)) {
      if (down) heldModifiers.Add(key.Key); else heldModifiers.Remove(key.Key);
    } else if (down && inputEnabled && heldModifiers.Count == 0 && GetForegroundWindow() == window) {
      string value = null;
      if (key.Key >= 0x30 && key.Key <= 0x39) value = ((char)key.Key).ToString();
      else if (key.Key >= 0x60 && key.Key <= 0x69) value = ((char)('0' + key.Key - 0x60)).ToString();
      else if ((key.Flags & 1) == 0) {
        // Normalize the physical keypad even when Num Lock was off before locking.
        keypad.TryGetValue(key.Scan, out value);
      }
      if (key.Key == 0x08) value = "Backspace";
      if (key.Key == 0x0D) value = "Enter";
      if (value != null) { keys.Enqueue(value); available.Set(); }
    }
    return new IntPtr(1);
  }
  private static void ReadCommands() {
    try {
      string line;
      var json = new JavaScriptSerializer { MaxJsonLength = 1024 };
      while ((line = Console.ReadLine()) != null) {
        if (line.Length > 1024) break;
        var command = json.Deserialize<Dictionary<string, object>>(line);
        if (command["command"].ToString() == "stop") break;
        inputEnabled = command.ContainsKey("input") && command["input"] is bool && (bool)command["input"];
        Interlocked.Exchange(ref lastHeartbeat, Stopwatch.GetTimestamp());
      }
    } catch {}
    stopping = true;
  }
  private static void WriteKeys() {
    try {
      while (!stopping) {
        available.WaitOne(100);
        string key;
        while (keys.TryDequeue(out key)) if (inputEnabled) Console.WriteLine("{\"type\":\"key\",\"key\":\"" + key + "\"}");
      }
    } catch { stopping = true; }
  }
  private static int Main(string[] args) {
    try {
      window = new IntPtr(long.Parse(args[0]));
      uint owner; GetWindowThreadProcessId(window, out owner);
      if (!IsWindow(window) || owner != uint.Parse(args[1])) throw new Exception("Invalid owner window.");
      using (var process = Process.GetProcessById((int)owner)) {
        foreach (uint key in new uint[] { 0x5B, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 }) if (GetAsyncKeyState((int)key) < 0) { heldModifiers.Add(key); initialModifiers.Add(key); }
        Interlocked.Exchange(ref lastHeartbeat, Stopwatch.GetTimestamp());
        hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) throw new Exception("Keyboard hook failed: " + Marshal.GetLastWin32Error());
        var reader = new Thread(ReadCommands) { IsBackground = true }; reader.Start();
        var writer = new Thread(WriteKeys) { IsBackground = true }; writer.Start();
        using (var timer = new System.Windows.Forms.Timer { Interval = 100 }) {
          timer.Tick += (sender, unused) => {
            if (stopping || process.HasExited || !IsWindow(window) || (Stopwatch.GetTimestamp() - Interlocked.Read(ref lastHeartbeat)) / (double)Stopwatch.Frequency > 4) Application.ExitThread();
          };
          timer.Start();
          Console.WriteLine("{\"type\":\"ready\"}");
          Application.Run();
        }
      }
      return 0;
    } catch (Exception error) {
      Console.WriteLine(new JavaScriptSerializer().Serialize(new { type = "error", error = error.Message }));
      return 1;
    } finally {
      stopping = true;
      if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
      foreach (uint key in initialModifiers) if (!heldModifiers.Contains(key)) {
        // A key held before the hook must not remain logically pressed after its swallowed key-up.
        var release = new Input { Type = 1, Data = new InputData { Keyboard = new KeyboardInput { Key = (ushort)key, Flags = 2 } } };
        SendInput(1, new[] { release }, Marshal.SizeOf(typeof(Input)));
      }
    }
  }
}
