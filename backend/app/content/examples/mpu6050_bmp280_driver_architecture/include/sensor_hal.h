#ifndef SENSOR_HAL_H
#define SENSOR_HAL_H

#include <stddef.h>
#include <stdint.h>

/*
 * Transport-agnostic I2C bus interface so sensor logic stays clean and testable
 * before wiring verified VEGA SDK I2C functions.
 */
typedef int (*vega_i2c_read_reg_fn)(
    void *ctx,
    uint8_t dev_addr_7bit,
    uint8_t reg_addr,
    uint8_t *out_buf,
    size_t len
);

typedef struct {
    void *ctx;
    vega_i2c_read_reg_fn read_reg;
} vega_i2c_bus_t;

/* Scaled integer telemetry avoids costly soft-float libraries on rv32i cores */
typedef struct {
    int32_t accel_mg_x;
    int32_t accel_mg_y;
    int32_t accel_mg_z;
    int32_t temp_centi_c;
} vega_imu_sample_t;

typedef struct {
    int32_t pressure_pa;
    int32_t temp_centi_c;
} vega_baro_sample_t;

static inline int vega_sensor_bus_valid(const vega_i2c_bus_t *bus)
{
    return (bus != NULL && bus->read_reg != NULL) ? 1 : 0;
}

#endif /* SENSOR_HAL_H */
