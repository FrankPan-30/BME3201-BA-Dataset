Three IMUs — MATLAB live dashboard

Start
- Double-click Start_Dashboard.cmd, or open run_imu_dashboard.m in VS Code and choose Run File.
- Default: COM3, 115200 baud. Close other serial viewers first.
- The English dashboard opens in a separate MATLAB window.
- If VS Code is in Restricted Mode, use the launcher; the MATLAB extension requires a trusted workspace to run code.

Layout
- One row per sensor: IMU 1, IMU 2, IMU 3.
- Left plot: acceleration (g). Right plot: angular velocity (deg/s).
- X is blue, Y is orange, Z is purple throughout.
- Each row shows its own LIVE / NO DATA status, magnitudes and valid-sample count.
- A missing sensor creates gaps (NaN), rather than fabricated zero measurements.
- Freeze plots keeps recording. Export CSV includes all received frames.
- Re-running creates a new session; export data first if needed.
- Closing the dashboard releases the serial port.

Wiring / identity
IMU 1: SDA GPIO1, SCL GPIO2, AD0 GND, bus0 address 0x68.
IMU 2: SDA GPIO1, SCL GPIO2, AD0 3V3, bus0 address 0x69.
IMU 3: SDA GPIO4, SCL GPIO5, AD0 GND, bus1 address 0x68.
All three: VCC 3V3; common GND. INT, XDA and XCL are unused.
IMU numbers identify bus/address, not anatomical placement.

Firmware
../firmware/BME3201_ThreeIMU/BME3201_ThreeIMU.ino
50 frames/s target; acceleration +/-2g; gyro +/-250 deg/s.
Each connection sends R to reinitialize all three modules.

Timing and CSV
The IMUs are read sequentially, not sampled by a shared hardware trigger.
Device frame time is the ESP32 frame-start micros counter, made relative to the first received frame; rollover is unwrapped.
A detected MCU reboot starts a new segment and keeps the display timeline increasing.
CSV includes segment, frame_sequence, device_time_s, host_time_s, valid_mask and 18 channel values.
Mask bits 0/1/2 correspond to IMU 1/2/3. Mask 7 means all three readings are valid in that frame.
Raw / uncalibrated: calibration is still required before interpreting absolute angles.
