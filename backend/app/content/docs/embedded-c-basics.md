# Embedded C Fundamentals for 256 KB SRAM

Writing reliable firmware for VEGA ARIES V3 (**256 KB on-chip SRAM**) benefits from strict C memory discipline:

1. **Prefer `<stdint.h>` exact-width types**: Use `uint8_t`, `int32_t`, and `uint32_t` rather than assuming `int`/`long` bit widths.
2. **Qualify hardware/ISR shared variables `volatile`**: Prevents the compiler from caching MMIO register reads or optimizing away ISR-updated flags cleanly. Note: `volatile` does not replace disabling interrupts on read-modify-write sequences.
3. **Prefer static allocation + `_Static_assert`**: Avoid dynamic heap (`malloc`/`free`) in long-running bare-metal firmware to prevent heap fragmentation and unpredictable OOM failures.
4. **Separate drivers from HAL transport**: Keep sensor scaling (`MPU6050`, `BMP280`) decoupled from raw I2C/SPI primitives cleanly.
