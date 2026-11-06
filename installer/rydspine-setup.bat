@echo off
rem rydspine installer for Windows: double-click it. Downloads the code into %USERPROFILE%\.rydspine\app,
rem installs its packages, then runs the setup wizard (src\setup.ts). Needs Windows 10+ (curl and tar built in).
chcp 65001 >nul
setlocal
if "%RYDSPINE_REPO%"=="" set "RYDSPINE_REPO=ryderdinh/rydspine-mcp"
if "%RYDSPINE_REF%"=="" set "RYDSPINE_REF=main"
if "%RYDSPINE_HOME%"=="" set "RYDSPINE_HOME=%USERPROFILE%\.rydspine"
set "APP=%RYDSPINE_HOME%\app"
set "DL=%RYDSPINE_HOME%\download"
echo rydspine — getting ready...

where node >nul 2>nul || goto nonode
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODEMAJOR=%%v"
if %NODEMAJOR% LSS 20 goto nonode

if exist "%DL%" rmdir /s /q "%DL%"
mkdir "%DL%" || goto fail
echo Downloading the source from github.com/%RYDSPINE_REPO% (%RYDSPINE_REF%)
curl -fsSL "https://codeload.github.com/%RYDSPINE_REPO%/tar.gz/%RYDSPINE_REF%" -o "%DL%\source.tar.gz" || goto fail
tar -xzf "%DL%\source.tar.gz" -C "%DL%" --strip-components=1 || goto fail
del "%DL%\source.tar.gz"
if exist "%APP%" rmdir /s /q "%APP%"
move "%DL%" "%APP%" >nul || goto fail
cd /d "%APP%"
echo Installing packages (about a minute the first time)...
call npm install --omit=dev --no-fund --no-audit --loglevel=error || goto fail
node node_modules\tsx\dist\cli.mjs src\setup.ts %*
goto end

:nonode
echo Node.js 20 or later is needed. Install the LTS version from https://nodejs.org, then double-click this file again.
start "" https://nodejs.org/
goto end

:fail
echo Setup failed; see the error above.

:end
echo.
pause
