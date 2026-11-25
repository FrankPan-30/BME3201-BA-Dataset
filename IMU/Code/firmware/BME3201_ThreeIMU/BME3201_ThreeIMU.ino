#include <Arduino.h>
#include <Wire.h>
#include <math.h>

// IMU 1: SDA=1, SCL=2, AD0=GND -> bus 0 / 0x68
// IMU 2: SDA=1, SCL=2, AD0=3V3 -> bus 0 / 0x69
// IMU 3: SDA=4, SCL=5, AD0=GND -> bus 1 / 0x68
// All three: VCC=3V3, GND=GND. INT/XDA/XCL are unused.
// Data frame: D,sequence,frame_start_us,valid_mask,18 values (IMU1..3).
// Values per IMU: ax,ay,az in g; gx,gy,gz in deg/s. Invalid IMUs emit nan.
// R + newline reinitializes all sensors; S + newline prints diagnostics.
// Reads are sequential; frame_start_us is not a shared sensor sample clock.
TwoWire *const buses[3] = {&Wire, &Wire, &Wire1};
const uint8_t addresses[3] = {0x68, 0x69, 0x68};
bool busOK[2] = {false, false};
bool ready[3] = {false, false, false};
uint32_t failures[3] = {0, 0, 0};
uint32_t sequence = 0;
uint32_t nextSample = 0;

bool writeReg(int i, uint8_t reg, uint8_t value) {
  TwoWire &bus = *buses[i];
  bus.beginTransmission(addresses[i]);
  bus.write(reg); bus.write(value);
  return bus.endTransmission() == 0;
}
bool readRegs(int i, uint8_t reg, uint8_t *buf, uint8_t count) {
  TwoWire &bus = *buses[i];
  bus.beginTransmission(addresses[i]); bus.write(reg);
  if (bus.endTransmission(false) != 0) return false;
  if (bus.requestFrom(addresses[i], static_cast<size_t>(count), true) != count) {
    while (bus.available()) bus.read();
    return false;
  }
  for (uint8_t j=0; j<count; ++j) buf[j] = bus.read();
  return true;
}
int16_t signed16(const uint8_t *p) {
  return static_cast<int16_t>((static_cast<uint16_t>(p[0]) << 8) | p[1]);
}
void probeBus(TwoWire &bus, int id) {
  for (uint8_t addr=0x68; addr<=0x69; ++addr) {
    bus.beginTransmission(addr);
    Serial.printf("# BUS%d 0x%02X %s\n",id,addr,
      bus.endTransmission()==0 ? "FOUND" : "NOT_FOUND");
  }
}
void initializeSensor(int i) {
  ready[i] = false;
  if (!busOK[i==2 ? 1 : 0]) return;
  uint8_t id=0;
  if (!readRegs(i,0x75,&id,1)) {
    Serial.printf("# IMU%d NOT_FOUND bus=%d addr=0x%02X\n",i+1,i==2?1:0,addresses[i]);
    return;
  }
  Serial.printf("# IMU%d WHO_AM_I=0x%02X bus=%d addr=0x%02X\n",i+1,id,i==2?1:0,addresses[i]);
  if (id!=0x68) { Serial.printf("# IMU%d BAD_CHIP_ID\n",i+1); return; }
  if (!writeReg(i,0x6B,0x80)) return;
  delay(100);
  bool ok=writeReg(i,0x6B,0x01);
  delay(100);
  ok &= writeReg(i,0x6C,0x00);
  ok &= writeReg(i,0x1A,0x03);
  ok &= writeReg(i,0x19,19);   // 50 Hz sensor rate
  ok &= writeReg(i,0x1B,0x00); // +/-250 deg/s, 131 LSB/(deg/s)
  ok &= writeReg(i,0x1C,0x00); // +/-2 g, 16384 LSB/g
  ready[i]=ok;
  failures[i]=0;
  Serial.printf("# IMU%d %s\n",i+1,ok?"READY":"CONFIG_FAILED");
}
void printStatus() {
  for (int i=0;i<3;++i)
    Serial.printf("# IMU%d configured=%u read_failures=%lu\n",i+1,ready[i],(unsigned long)failures[i]);
}
void initializeAll() {
  if (busOK[0]) probeBus(Wire,0);
  if (busOK[1]) probeBus(Wire1,1);
  for (int i=0;i<3;++i) initializeSensor(i);
  delay(100);
  printStatus();
  nextSample=micros();
}
void setup() {
  Serial.begin(115200);
  delay(1200);
  Serial.println("# BME3201 THREE_IMU v1; 115200 baud; 50 frames/s; +/-2g +/-250deg/s");
  busOK[0]=Wire.begin(1,2,100000);
  busOK[1]=Wire1.begin(4,5,100000);
  Wire.setTimeOut(20); Wire1.setTimeOut(20);
  if (!busOK[0]) Serial.println("# BUS0 INIT_FAILED");
  if (!busOK[1]) Serial.println("# BUS1 INIT_FAILED");
  initializeAll();
}
void loop() {
  while (Serial.available()) {
    char command=Serial.read();
    if (command=='R') initializeAll();
    if (command=='S') printStatus();
  }
  uint32_t now=micros();
  if (static_cast<int32_t>(now-nextSample)<0) { delay(1); return; }
  nextSample+=20000;
  if (static_cast<int32_t>(now-nextSample)>=0) nextSample=now+20000;
  float values[18];
  for (float &value:values) value=NAN;
  uint8_t mask=0;
  for (int i=0;i<3;++i) {
    if (!ready[i]) continue;
    uint8_t b[14];
    if (!readRegs(i,0x3B,b,14)) {
      ++failures[i];
      if (failures[i]==1 || failures[i]%250==0)
        Serial.printf("# IMU%d READ_FAILED total=%lu\n",i+1,(unsigned long)failures[i]);
      continue;
    }
    for (int axis=0;axis<3;++axis) {
      values[i*6+axis]=signed16(b+axis*2)/16384.0f;
      values[i*6+axis+3]=signed16(b+8+axis*2)/131.0f;
    }
    mask |= 1u<<i;
  }
  Serial.printf("D,%lu,%lu,%u",(unsigned long)sequence++,(unsigned long)now,mask);
  for (float value:values) Serial.printf(",%.3f",value);
  Serial.println();
}
