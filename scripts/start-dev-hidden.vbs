' SYRIX Forma — hidden dev launcher. The Desktop shortcut targets this file
' instead of start-dev.bat directly, so double-clicking it runs the batch
' script with window style 0 (hidden) — no console flashes open. Use
' stop-dev.bat to shut the server down again, since there's no window to
' close.
Set objFSO = CreateObject("Scripting.FileSystemObject")
scriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
Set objShell = CreateObject("WScript.Shell")
objShell.Run """" & scriptDir & "\start-dev.bat""", 0, False
