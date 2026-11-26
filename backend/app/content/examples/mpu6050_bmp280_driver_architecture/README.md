# MPU6050 IMU & BMP280 Barometer HAL Architecture

> **Conceptual Example** — Models integer-scaled sensor sample types and an abstract `vega_i2c_bus_t` transport boundary matching VEGA ARIES V3's verified onboard sensors (MPU6050 + BMP280). Register offsets and I2C peripheral setup must come from verified C-DAC VEGA SDK headers and component datasheets.
