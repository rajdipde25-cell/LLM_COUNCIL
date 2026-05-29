Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File C:\Users\rajdi\freellmapi\monitor_power.ps1", 0, False
