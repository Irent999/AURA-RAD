@echo off
chcp 65001 >nul
set "APP=%LOCALAPPDATA%\Programs\AURA-RAD"
if not "%~1"=="" set "APP=%~1"
if not exist "%APP%\resources\.output" (
  echo Не найдена папка "%APP%\resources\.output".
  echo Запустите так: apply_patch.bat "C:\путь\к\AURA-RAD"
  exit /b 1
)
echo Резервная копия: "%APP%\resources\.output.bak"
if not exist "%APP%\resources\.output.bak" xcopy "%APP%\resources\.output" "%APP%\resources\.output.bak\" /E /I /Q >nul
xcopy "%~dp0.output" "%APP%\resources\.output\" /E /I /Y /Q >nul
echo Готово. Запустите AURA-RAD. Откат: удалить .output и переименовать .output.bak в .output
