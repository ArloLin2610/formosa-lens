@echo off
title Formosa Lens
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org/ , install it, then double-click this file again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing packages, this takes a minute or two...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Take a screenshot of this window.
    pause
    exit /b 1
  )
)
echo Starting Formosa Lens... keep this window open while you use the site.
start "Formosa Lens server" cmd /k npm run dev:full
timeout /t 12 /nobreak >nul
start "" http://127.0.0.1:5173
exit /b 0
