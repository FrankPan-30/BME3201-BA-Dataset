@echo off
rem Optional: set MATLAB_EXE to the full path of matlab.exe.
if not defined MATLAB_EXE set "MATLAB_EXE=matlab"
where "%MATLAB_EXE%" >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\MATLAB\R2025b\bin\matlab.exe" (
    set "MATLAB_EXE=%ProgramFiles%\MATLAB\R2025b\bin\matlab.exe"
  ) else (
    echo MATLAB was not found. Add its bin folder to PATH or set MATLAB_EXE.
    exit /b 1
  )
)
start "" /b "%MATLAB_EXE%" -nosplash -nodesktop -r "run('%~dp0run_imu_dashboard.m')"
