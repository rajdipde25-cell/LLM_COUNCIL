Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c cd /d C:\Users\rajdi\freellmapi && npm run dev", 0, False
