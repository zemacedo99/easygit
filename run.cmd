@echo off
REM ---------------------------------------------------------------------------
REM EasyGit launcher for Windows.
REM Double-click this file (or run it from a terminal) to start EasyGit.
REM It installs dependencies the first time, then launches the app.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found. Please install Node.js from https://nodejs.org
  echo and then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing EasyGit for the first time. This may take a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo Something went wrong while installing. Please check the messages above.
    pause
    exit /b 1
  )
)

echo Starting EasyGit...
call npm start
