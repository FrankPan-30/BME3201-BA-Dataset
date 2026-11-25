Three-IMU hardware bring-up and live visualization

Code/firmware/BME3201_ThreeIMU/ : current ESP32-S3 firmware for three MPU-6050 modules.
Code/firmware/BME3201_IMU_Test/ : initial single-module bring-up firmware.
Code/matlab/                  : English three-row MATLAB live dashboard and launcher.
results/                     : successful three-module test recording and validation.
results/single_imu/          : earlier single-module motion test and notes.

Start with Code/matlab/README.txt for wiring, run instructions and CSV fields.
Open Code/matlab in VS Code, then run run_imu_dashboard.m. On Windows, Start_Dashboard.cmd is an alternative; it looks for MATLAB on PATH or uses MATLAB_EXE, with R2025b in Program Files as a fallback.
The Windows launcher requires a normal path without an apostrophe. Other platforms can run the MATLAB entry script directly.

Validated locally with MATLAB R2025b, Arduino IDE 2.3.10, ESP32 board package 3.3.12.
All three IMUs use 3.3 V and common ground. IMU1/2 share GPIO1/2 with addresses 0x68/0x69; IMU3 uses GPIO4/5 at 0x68.
Target: 50 frames/s, acceleration +/-2g, gyro +/-250 deg/s.

The 467-frame three-module recording contains 467 valid samples for each IMU, with no frame sequence gaps. See results/validation.json. The single-module file is a separate earlier recording.
Data are raw and uncalibrated. No anatomical placement or clinical outcome labels are assigned. The three IMUs are polled sequentially; shared-trigger synchronization is not established. These recordings were collected during local hardware checks and do not belong to the repository's published BA mirror.
