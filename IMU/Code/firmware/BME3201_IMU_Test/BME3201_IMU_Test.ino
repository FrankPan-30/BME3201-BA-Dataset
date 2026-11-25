#include <Arduino.h>
#include <Wire.h>

// BME3201: GY-521/MPU-6050 -> ESP32-S3
// VCC=3V3, GND=GND, SDA=GPIO1, SCL=GPIO2, AD0=GND.
// Register reference: https://invensense.tdk.com/wp-content/uploads/2015/02/MPU-6000-Register-Map.pdf
constexpr int SDA_PIN = 1;
constexpr int SCL_PIN = 2;
constexpr uint8_t MPU_ADDR = 0x68;
bool ready = false;
const char *lastError = "Not initialized";
uint32_t nextSample = 0;

bool writeReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}
bool readRegs(uint8_t reg, uint8_t *buf, uint8_t count) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  size_t received = Wire.requestFrom(MPU_ADDR, count, true);
  if (received != count) {
    while (Wire.available()) Wire.read();
    return false;
  }
  for (uint8_t i=0; i<count; ++i) buf[i] = Wire.read();
  return true;
}
int16_t toInt16(const uint8_t *p) {
  return static_cast<int16_t>((static_cast<uint16_t>(p[0]) << 8) | p[1]);
}
void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("BME3201 MPU6050 test: SDA=1 SCL=2, 115200 baud");
  if (!Wire.begin(SDA_PIN, SCL_PIN, 100000)) {
    lastError = "I2C initialization failed";
    return;
  }
  Wire.setTimeOut(50);
  Serial.println("Scanning I2C...");
  int found=0;
  for (uint8_t addr=1; addr<127; ++addr) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission()==0) {
      Serial.printf("Found device at 0x%02X\n", addr);
      ++found;
    }
  }
  if (!found) { lastError="No I2C device: check power, ground, SDA and SCL"; return; }
  uint8_t id=0;
  if (!readRegs(0x75, &id, 1)) { lastError="Cannot read 0x68: check AD0 is GND"; return; }
  Serial.printf("WHO_AM_I = 0x%02X\n", id);
  if (id!=0x68) { lastError="Unexpected chip ID: verify module model"; return; }
  if (!writeReg(0x6B,0x80)) { lastError="Reset failed"; return; }
  delay(100);
  bool ok=writeReg(0x6B,0x01);
  delay(100);
  ok &= writeReg(0x6C,0x00);
  ok &= writeReg(0x1A,0x03); // DLPF enabled, gyro output rate 1 kHz
  ok &= writeReg(0x19,19);   // sensor sample rate 50 Hz
  ok &= writeReg(0x1B,0x00); // gyro +/-250 deg/s, 131 LSB/(deg/s)
  ok &= writeReg(0x1C,0x00); // accel +/-2 g, 16384 LSB/g
  if (!ok) { lastError="Configuration failed"; return; }
  delay(100);
  Serial.println("MPU6050 ready. Accel=g; Gyro=deg/s; output target=50 Hz (polling)");
  nextSample=micros();
  ready=true;
}
void loop() {
  if (!ready) { Serial.printf("ERROR: %s. Fix then press RESET.\n", lastError); delay(1000); return; }
  uint32_t now=micros();
  if (static_cast<int32_t>(now-nextSample)<0) { delay(1); return; }
  nextSample += 20000;
  // Avoid a burst of catch-up reads after a slow USB write or I2C error.
  if (static_cast<int32_t>(now-nextSample)>=0) nextSample=now+20000;
  uint8_t b[14];
  if (!readRegs(0x3B,b,14)) {
    Serial.println("ERROR: Data read failed; check wiring");
    delay(200);
    return;
  }
  Serial.printf("ax:%.3f\tay:%.3f\taz:%.3f\tgx:%.3f\tgy:%.3f\tgz:%.3f\n",
    toInt16(b)/16384.0f, toInt16(b+2)/16384.0f, toInt16(b+4)/16384.0f,
    toInt16(b+8)/131.0f, toInt16(b+10)/131.0f, toInt16(b+12)/131.0f);
}
