using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public static class KeyboardProbe {
  public class Key { public ushort vk, scan; public uint flags; }
  public class Command { public int id, x, y; public long window; public bool click; public string command; public Key[] events; }
  [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] private struct Mouse { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] private struct Keyboard { public ushort Vk, Scan; public uint Flags, Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Explicit, Size = 32)] private struct Union { [FieldOffset(0)] public Keyboard Keyboard; [FieldOffset(0)] public Mouse Mouse; }
  [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public Union Data; }
  [StructLayout(LayoutKind.Sequential)] private struct KeyData { public uint Key, Scan, Flags, Time; public UIntPtr Extra; }
  private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] private static extern uint SendInput(uint count, Input[] inputs, int size);
  [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint thread);
  [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string module);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int x,int y);
  private static readonly HookProc callback = Observe;
  private static IntPtr hook;
  private static int received;
  private static volatile bool stopping;
  private const uint Marker = 0x44415941;
  private static IntPtr Observe(int code, IntPtr message, IntPtr data) {
    if (code >= 0 && ((KeyData)Marshal.PtrToStructure(data, typeof(KeyData))).Extra.ToUInt64() == Marker) Interlocked.Increment(ref received);
    return CallNextHookEx(hook, code, message, data);
  }
  private static void Read() {
    var json = new JavaScriptSerializer();
    string line;
    while ((line = Console.ReadLine()) != null) {
      var command = json.Deserialize<Command>(line);
      if (command.command == "stop") break;
      var target = new IntPtr(command.window);
      if (command.click) {
        var point = new Point { X = command.x, Y = command.y };
        if (GetAncestor(WindowFromPoint(point), 2) != target) throw new Exception("Test window is covered; refusing to click.");
        Point previous; GetCursorPos(out previous);
        SetCursorPos(point.X,point.Y);
        SendInput(2,new[] {new Input { Data = new Union { Mouse = new Mouse { Flags = 2 } } },new Input { Data = new Union { Mouse = new Mouse { Flags = 4 } } }},Marshal.SizeOf(typeof(Input)));
        Thread.Sleep(100);
        SetCursorPos(previous.X,previous.Y);
      }
      if (GetForegroundWindow() != target) { Console.WriteLine(json.Serialize(new { id = command.id, error = "Test window is not foreground; refusing keyboard input." })); continue; }
      Interlocked.Exchange(ref received, 0);
      var inputs = Array.ConvertAll(command.events, key => new Input { Type = 1, Data = new Union { Keyboard = new Keyboard { Vk = key.vk, Scan = key.scan, Flags = key.flags, Extra = new UIntPtr(Marker) } } });
      uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
      Thread.Sleep(200);
      Console.WriteLine(json.Serialize(new { id = command.id, sent = sent, received = Interlocked.CompareExchange(ref received, 0, 0) }));
    }
    stopping = true;
  }
  public static void Main() {
    hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
    if (hook == IntPtr.Zero) throw new Exception("Probe hook unavailable.");
    try {
      new Thread(Read) { IsBackground = true }.Start();
      using (var timer = new System.Windows.Forms.Timer { Interval = 100 }) {
        timer.Tick += (sender, unused) => { if (stopping) Application.ExitThread(); };
        timer.Start();
        Console.WriteLine("{\"ready\":true}");
        Application.Run();
      }
    } finally { UnhookWindowsHookEx(hook); }
  }
}
