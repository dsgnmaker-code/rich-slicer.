@echo off
setlocal
set "PS_SCRIPT=%~dp0Rich_Slicer_Easy.jsx"
if not exist "%PS_SCRIPT%" (
  echo ERROR: Rich_Slicer_Easy.jsx not found next to this installer.
  pause
  exit /b 1
)
set "PSINSTALLER=%~dp0Install_Windows.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PSINSTALLER%"
if errorlevel 1 echo Installation did not finish. You can still use File ^> Scripts ^> Browse in Photoshop.
pause
