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
echo rydspine — đang chuẩn bị...

where node >nul 2>nul || goto nonode
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODEMAJOR=%%v"
if %NODEMAJOR% LSS 20 goto nonode

if exist "%DL%" rmdir /s /q "%DL%"
mkdir "%DL%" || goto fail
echo Tải mã nguồn từ github.com/%RYDSPINE_REPO% (%RYDSPINE_REF%)
curl -fsSL "https://codeload.github.com/%RYDSPINE_REPO%/tar.gz/%RYDSPINE_REF%" -o "%DL%\source.tar.gz" || goto fail
tar -xzf "%DL%\source.tar.gz" -C "%DL%" --strip-components=1 || goto fail
del "%DL%\source.tar.gz"
if exist "%APP%" rmdir /s /q "%APP%"
move "%DL%" "%APP%" >nul || goto fail
cd /d "%APP%"
echo Cài thư viện (lần đầu mất khoảng một phút)...
call npm install --omit=dev --no-fund --no-audit --loglevel=error || goto fail
node node_modules\tsx\dist\cli.mjs src\setup.ts %*
goto end

:nonode
echo Cần Node.js 20 trở lên. Cài bản LTS ở https://nodejs.org rồi bấm đúp lại file này.
start "" https://nodejs.org/
goto end

:fail
echo Cài đặt thất bại; xem lỗi ở trên.

:end
echo.
pause
