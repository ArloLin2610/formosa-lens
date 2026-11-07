@echo off
title Deploy Formosa Lens to Netlify
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org/ , install it, then double-click this file again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing packages, this takes a minute or two...
  call npm install
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)
echo.
echo Step 1/2: a browser window opens so you can sign in to Netlify. Click Authorize, then come back here.
call npx --yes netlify-cli@latest login
echo.
echo Step 2/2: building and deploying. When asked, choose "Create & configure a new project",
echo pick your team, and press Enter to accept the suggested name (or type one).
call npx --yes netlify-cli@latest deploy --build --prod
echo.
echo Done. The line "Website URL" above is your permanent address. Run this file again any time to deploy an update.
pause
