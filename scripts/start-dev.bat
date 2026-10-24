@echo off
REM SYRIX Forma — local dev launcher. Starts the Next.js dev server and opens
REM the app in the default browser once it's actually ready to respond.
REM Launched hidden via start-dev-hidden.vbs (the Desktop shortcut targets
REM that, not this file directly) — /B keeps npm run dev from popping its
REM own console window on top of that.
setlocal

REM A dev server from a previous run that didn't shut down cleanly (crashed,
REM machine slept, VS Code killed instead of stop-dev.bat) leaves a node
REM process running indefinitely. That old server locks apps/web/.next/dev,
REM so a brand new "npm run dev" doesn't cleanly move to the next port —
REM it collides with the lock and dies within seconds, and this shortcut's
REM curl check (fixed at port 3000) never sees anything come up, so it just
REM opens the browser on a dead port after the 60s timeout. Kill anything
REM already listening across the whole range Next.js would try, not just
REM 3000, so every launch starts one clean server on 3000.
for %%P in (3000 3001 3002 3003 3004 3005) do (
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%%P " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
  )
)

cd /d "%~dp0..\apps\web"
start /B "" cmd /c "npm run dev"

REM Poll instead of guessing a fixed wait — Next.js compiles each route on
REM first hit, which can take well over a few seconds on a cold start.
REM Opening the browser too early is what shows a blank/broken page. Gives
REM up after ~60s and opens anyway rather than waiting forever.
set /a TRIES=0
:waitloop
curl -s -o nul "http://localhost:3000" 2>nul
if %errorlevel%==0 goto ready
set /a TRIES+=1
if %TRIES% geq 60 goto ready
timeout /t 1 /nobreak >nul
goto waitloop

:ready
start "" http://localhost:3000
endlocal
