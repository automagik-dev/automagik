# Own the vendor's full Windows process tree, including children of an exited .cmd wrapper.
# Job children cannot break away. An abnormal supervisor exit closes the kill-on-close job.
# Normal stop proves ActiveProcesses=0 before acknowledging it to the parent.
$ErrorActionPreference = 'Stop'
$phase = 'load-system-commands'
try {
  # These commands must not depend on a terminal's PSModulePath or user-installed modules.
  Import-Module "$PSHOME\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1"
  $phase = 'read-request'
  $request = $env:AUTOMAGIK_LOGIN_JOB | ConvertFrom-Json
  [Environment]::SetEnvironmentVariable('AUTOMAGIK_LOGIN_JOB', $null, 'Process')
  $phase = 'compile-supervisor'
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class AutomagikLoginJob {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct Startup {
    public uint cb;
    public string reserved, desktop, title;
    public uint x, y, width, height, charsX, charsY, fill, flags;
    public ushort show, reservedSize;
    public IntPtr reservedPointer, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
  [StructLayout(LayoutKind.Sequential)]
  struct Limits {
    public long processTime, jobTime;
    public uint flags;
    public UIntPtr minWorkingSet, maxWorkingSet;
    public uint activeLimit;
    public UIntPtr affinity;
    public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters {
    public ulong reads, writes, other, readBytes, writeBytes, otherBytes;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimits {
    public Limits basic;
    public IoCounters io;
    public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct Accounting {
    public long userTime, kernelTime, periodUserTime, periodKernelTime;
    public uint pageFaults, totalProcesses, activeProcesses, terminatedProcesses;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind,
    ref ExtendedLimits info, uint length);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int kind,
    out Accounting info, uint length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcess(string executable, StringBuilder command,
    IntPtr processSecurity, IntPtr threadSecurity, bool inheritHandles, uint flags,
    IntPtr environment, string directory, ref Startup startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

  static void Check(bool ok) {
    if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
  static IntPtr Standard(int kind) {
    IntPtr handle = GetStdHandle(kind);
    if (handle == IntPtr.Zero || handle == new IntPtr(-1)) {
      throw new InvalidOperationException("Missing login pipe.");
    }
    Check(SetHandleInformation(handle, 1, 1));
    return handle;
  }
  static bool ParentGone(IntPtr parent) {
    uint state = WaitForSingleObject(parent, 0);
    if (state == 0) return true;
    if (state == 0x102) return false; // WAIT_TIMEOUT: original parent is still running.
    throw new Win32Exception(Marshal.GetLastWin32Error());
  }
  public static int Run(string executable, string command, string directory,
    string stop, string done, string nonce, uint parentPid,
    string challenge, string acknowledge) {
    IntPtr job = IntPtr.Zero;
    IntPtr parent = IntPtr.Zero;
    ProcessInfo process = new ProcessInfo();
    bool assigned = false;
    try {
      // A cancellation during PowerShell startup must never start a vendor process.
      if (File.Exists(stop)) { File.WriteAllText(done, nonce); return 130; }
      // Keep the original process handle, never re-open its PID during polling. No access or
      // no process means no safe parent lifetime to follow, so no vendor is started.
      parent = OpenProcess(0x00100000, false, parentPid); // SYNCHRONIZE
      if (parent == IntPtr.Zero || ParentGone(parent)) {
        File.WriteAllText(done, nonce);
        return 130;
      }
      // Bind the acquired handle to this app instance, not a reused PID. A dead app cannot
      // acknowledge the supervisor's fresh challenge even if its PID has been recycled.
      File.WriteAllText(challenge, nonce);
      DateTime deadline = DateTime.UtcNow.AddSeconds(10);
      while (!File.Exists(acknowledge) || File.ReadAllText(acknowledge) != nonce) {
        if (ParentGone(parent) || File.Exists(stop) || DateTime.UtcNow >= deadline) {
          File.WriteAllText(done, nonce);
          return 130;
        }
        Thread.Sleep(20);
      }
      if (ParentGone(parent) || File.Exists(stop)) {
        File.WriteAllText(done, nonce);
        return 130;
      }
      job = CreateJobObject(IntPtr.Zero, null);
      Check(job != IntPtr.Zero);
      ExtendedLimits limits = new ExtendedLimits();
      limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
      Check(SetInformationJobObject(job, 9, ref limits,
        (uint)Marshal.SizeOf(typeof(ExtendedLimits))));
      Startup startup = new Startup();
      startup.cb = (uint)Marshal.SizeOf(typeof(Startup));
      startup.flags = 0x100; // STARTF_USESTDHANDLES
      startup.input = Standard(-10);
      startup.output = Standard(-11);
      startup.error = Standard(-12);
      // CREATE_SUSPENDED closes the child-before-job-assignment escape window.
      Check(CreateProcess(executable, new StringBuilder(command), IntPtr.Zero,
        IntPtr.Zero, true, 0x08000004, IntPtr.Zero, directory, ref startup, out process));
      Check(AssignProcessToJobObject(job, process.process));
      assigned = true;
      bool ending = false;
      if (ParentGone(parent) || File.Exists(stop)) {
        Check(TerminateJobObject(job, 130));
        ending = true;
      } else Check(ResumeThread(process.thread) != UInt32.MaxValue);
      while (true) {
        if (!ending && (ParentGone(parent) || File.Exists(stop))) {
          Check(TerminateJobObject(job, 130));
          ending = true;
        }
        Accounting info;
        Check(QueryInformationJobObject(job, 1, out info,
          (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
        if (info.activeProcesses == 0) break;
        Thread.Sleep(20);
      }
      uint code;
      Check(GetExitCodeProcess(process.process, out code));
      // This acknowledgement is produced only after the entire job is empty.
      File.WriteAllText(done, nonce);
      return (int)code;
    } finally {
      // An assignment failure leaves a suspended process; it must never be resumed/leaked.
      if (!assigned && process.process != IntPtr.Zero) TerminateProcess(process.process, 125);
      if (process.thread != IntPtr.Zero) CloseHandle(process.thread);
      if (process.process != IntPtr.Zero) CloseHandle(process.process);
      if (job != IntPtr.Zero) CloseHandle(job);
      if (parent != IntPtr.Zero) CloseHandle(parent);
    }
  }
}
'@
  [Environment]::SetEnvironmentVariable('PSModulePath', $request.modulePath, 'Process')
  $phase = 'own-login-job'
  $code = [AutomagikLoginJob]::Run($request.executable, $request.line, $request.cwd,
    $request.stop, $request.done, $request.nonce, $request.parent,
    $request.challenge, $request.acknowledge)
  exit $code
} catch {
  # Never expose paths, command output or vendor account information as diagnostics.
  $exception = $_.Exception
  while ($null -ne $exception.InnerException) { $exception = $exception.InnerException }
  $failure = '{0}: {1} (HRESULT {2})' -f $phase, $exception.GetType().FullName,
    $exception.HResult
  [Console]::Error.WriteLine("The login process could not start safely. $failure")
  exit 125
}
