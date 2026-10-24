@echo off
REM SYRIX Forma — stops the dev server started by start-dev-hidden.vbs. That
REM launcher runs with no visible window, so there's nothing to Alt+F4 —
REM this is the way to shut it down instead. Only touches the process
REM actually listening on port 3000, not every node.exe on the machine.
setlocal
set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
  set FOUND=1
)
if "%FOUND%"=="1" (
  echo SYRIX Forma dev server stopped.
) else (
  echo No dev server was running on port 3000.
)
pause
endlocal
