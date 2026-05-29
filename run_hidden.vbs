Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c cd /d C:\Users\rajdi\llm_council && npm run dev", 0, False
