# Captures one window to a PNG, optionally resizing it first.
#
#   -ProcessId 1234                    the window of that process
#   -TitleLike "*Wikipedia*"           the first visible window whose title matches
#   -Width 1280 -Height 800            resize before capturing
#
# CDP cannot photograph Chrome's own frame, and the store screenshots are more
# useful with the address bar in them — that is what shows a reader the extension
# is working on a file:// document rather than on a web page.
#
# The process is made DPI aware first. Without it Windows virtualises the
# coordinates for this script but not for the compositor, so on a scaled display
# the rectangle asked for and the rectangle copied are different ones, and the
# capture comes out cropped with a slice of the desktop along one edge.
#
# The size printed on exit is the size actually captured, not the size requested.
# On a scaled display they differ — 1280x800 asked for comes back as 1600x1000 at
# 125% — and the caller needs the real number to scale the image down correctly.

param(
  [int]$ProcessId = 0,
  [string]$TitleLike = '',
  [Parameter(Mandatory = $true)][string]$OutPath,
  [int]$Width = 0,
  [int]$Height = 0
)

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

  /**
   * The bounds you can SEE.
   *
   * GetWindowRect includes the invisible resize border Windows keeps around a
   * window — roughly eight pixels a side. Capturing that rectangle copies a strip
   * of whatever is behind the window along the left, right and bottom edges, which
   * in a screenshot reads as a rendering bug. DWMWA_EXTENDED_FRAME_BOUNDS (9) is
   * the drawn frame; it is what the eye considers the window.
   */
  public static RECT Frame(IntPtr h) {
    RECT r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) == 0 && r.R > r.L) return r;
    GetWindowRect(h, out r);
    return r;
  }

  public static string Title(IntPtr h) {
    int n = GetWindowTextLength(h);
    if (n == 0) return "";
    var sb = new StringBuilder(n + 1);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }

  public static List<IntPtr> Visible() {
    var found = new List<IntPtr>();
    EnumWindows((h, p) => { if (IsWindowVisible(h) && Title(h).Length > 0) found.Add(h); return true; }, IntPtr.Zero);
    return found;
  }
}
"@

[void][Win]::SetProcessDPIAware()

# --- pick the window -------------------------------------------------------

$hwnd = [IntPtr]::Zero
$how = ''

if ($TitleLike) {
  foreach ($h in [Win]::Visible()) {
    if ([Win]::Title($h) -like $TitleLike) { $hwnd = $h; $how = "title '$([Win]::Title($h))'"; break }
  }
  if ($hwnd -eq [IntPtr]::Zero) {
    $seen = ([Win]::Visible() | ForEach-Object { '  ' + [Win]::Title($_) }) -join "`n"
    throw "No visible window matching '$TitleLike'. Visible windows:`n$seen"
  }
} elseif ($ProcessId -gt 0) {
  $hwnd = (Get-Process -Id $ProcessId).MainWindowHandle
  $how = "process $ProcessId"
  if ($hwnd -eq [IntPtr]::Zero) { throw "Process $ProcessId has no window" }
} else {
  throw 'Pass -ProcessId or -TitleLike'
}

# --- bring it forward, size it ---------------------------------------------

[void][Win]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 400

if ($Width -gt 0 -and $Height -gt 0) {
  # SW_RESTORE unconditionally, not only when minimised. A MAXIMISED window
  # ignores SetWindowPos silently: the call returns true, the window does not
  # move, and the capture comes back at whatever size the screen happens to be.
  [void][Win]::ShowWindow($hwnd, 9)
  Start-Sleep -Milliseconds 300
  # SWP_NOZORDER (0x4) | SWP_NOACTIVATE (0x10). The window is placed at a small
  # offset rather than at 0,0 so no edge sits under the taskbar or off-screen,
  # which would come back as a black band in the capture.
  [void][Win]::SetWindowPos($hwnd, [IntPtr]::Zero, 40, 40, $Width, $Height, 0x14)
  Start-Sleep -Milliseconds 700

  # SetWindowPos sizes the OUTER rectangle, the capture takes the DRAWN one, and
  # the two differ by the invisible border. Asking for 1600 therefore yields 1584.
  # The gap is measured once and added back, so the picture comes out at the size
  # asked for instead of near it.
  $f = [Win]::Frame($hwnd)
  $dx = $Width - ($f.R - $f.L)
  $dy = $Height - ($f.B - $f.T)
  if ($dx -ne 0 -or $dy -ne 0) {
    [void][Win]::SetWindowPos($hwnd, [IntPtr]::Zero, 40, 40, $Width + $dx, $Height + $dy, 0x14)
    Start-Sleep -Milliseconds 500
  }
} elseif ([Win]::IsIconic($hwnd)) {
  [void][Win]::ShowWindow($hwnd, 9)
  Start-Sleep -Milliseconds 300
}

$r = [Win]::Frame($hwnd)

$w = $r.R - $r.L
$h = $r.B - $r.T
if ($w -le 0 -or $h -le 0) { throw "Window has no size: ${w}x${h}" }

Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

"${w}x${h} ($how)"
