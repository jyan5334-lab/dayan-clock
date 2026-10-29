using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Drawing;

public static class DesktopShellProbe {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetMenuString(IntPtr menu, uint item, StringBuilder text, int length, uint flags);
  [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
  delegate bool EnumProc(IntPtr window, IntPtr extra);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr extra);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int size);
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr hwnd, ref Point point);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint Type; public MouseInput Mouse; }
  [DllImport("user32.dll")] static extern uint SendInput(uint count, Input[] input, int size);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  public static int Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false);
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var list = new IntPtr(long.Parse(args[0]));
    int count = SendMessage(list, 0x1004, IntPtr.Zero, IntPtr.Zero).ToInt32();
    if (FindWindow("#32768", null) != IntPtr.Zero) throw new Exception("Another context menu is already open; refusing to disturb it.");
    int x = int.Parse(args[1]), y = int.Parse(args[2]);
    var point = new Point { X = x, Y = y };
    if(WindowFromPoint(point)!=list)throw new Exception("Another application covers the test point; refusing to click.");
    Point originalCursor; GetCursorPos(out originalCursor);
    SetCursorPos(x,y);
    if(SendInput(2,new[]{new Input{Mouse=new MouseInput{Flags=8}},new Input{Mouse=new MouseInput{Flags=16}}},Marshal.SizeOf(typeof(Input)))!=2){SetCursorPos(originalCursor.X,originalCursor.Y);throw new Exception("Right-click input was not accepted.");}
    var labels = new List<string>();
    IntPtr window = IntPtr.Zero;
    try {
      for (int attempt = 0; attempt < 30; attempt++) {
        window = FindWindow("#32768", null);
        if (window != IntPtr.Zero) break;
        Thread.Sleep(100);
      }
      if (window != IntPtr.Zero) {
        var menu = SendMessage(window, 0x01E1, IntPtr.Zero, IntPtr.Zero);
        for (uint index = 0; index < GetMenuItemCount(menu); index++) {
          var text = new StringBuilder(512);
          GetMenuString(menu, index, text, text.Capacity, 0x400);
          labels.Add(text.ToString());
        }
      }
      var visible = new List<string>();
      var modernMenus = new List<IntPtr>();
      EnumWindows((handle,extra) => { if(IsWindowVisible(handle)){ var cls = new StringBuilder(256); GetClassName(handle,cls,256); visible.Add(cls.ToString()); if(cls.ToString()=="Microsoft.UI.Content.PopupWindowSiteBridge")modernMenus.Add(handle); } return true; },IntPtr.Zero);
      foreach(var popup in modernMenus) {
        try {
          var controls = AutomationElement.FromHandle(popup).FindAll(TreeScope.Descendants, Condition.TrueCondition);
          for(int index=0;index<controls.Count;index++) { var current=controls[index].Current; if(!current.IsOffscreen && !String.IsNullOrEmpty(current.Name))labels.Add(current.Name); }
          PostMessage(popup,0x0100,new IntPtr(0x1B),IntPtr.Zero);
        } catch(ElementNotAvailableException) {}
      }
      if(modernMenus.Count>0 && labels.Count>0) window=modernMenus[0];
      if(args.Length==8){
        using(var image=new Bitmap(int.Parse(args[6]),int.Parse(args[7]))) {
          using(var graphics=Graphics.FromImage(image))graphics.CopyFromScreen(int.Parse(args[4]),int.Parse(args[5]),0,0,image.Size);
          image.Save(args[3],System.Drawing.Imaging.ImageFormat.Png);
        }
      }
      Console.WriteLine(new JavaScriptSerializer().Serialize(new { iconCount = count, menuOpened = window != IntPtr.Zero, items = labels, visibleClasses = visible }));
    } finally {
      if (window != IntPtr.Zero) PostMessage(window, 0x0100, new IntPtr(0x1B), IntPtr.Zero);
      PostMessage(list, 0x001F, IntPtr.Zero, IntPtr.Zero);
      PostMessage(GetParent(list), 0x001F, IntPtr.Zero, IntPtr.Zero);
      SetCursorPos(originalCursor.X,originalCursor.Y);
    }
    return 0;
  }
}
