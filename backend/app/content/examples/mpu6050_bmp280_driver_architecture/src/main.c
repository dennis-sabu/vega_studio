#include <stdint.h>
#include "sensor_hal.h"

/* Placeholder read returning error until verified VEGA SDK I2C driver is connected */
static int unattached_i2c_read(
    void *ctx,
    uint8_t dev_addr_7bit,
    uint8_t reg_addr,
    uint8_t *out_buf,
    size_t len
)
{
    (void)ctx;
    (void)dev_addr_7bit;
    (void)reg_addr;
    (void)out_buf;
    (void)len;
    return -1; /* Not wired to SDK I2C yet */
}

int main(void)
{
    vega_i2c_bus_t bus = {
        .ctx = NULL,
        .read_reg = unattached_i2c_read,
    };

    vega_imu_sample_t imu = {0};
    vega_baro_sample_t baro = {0};
    (void)imu;
    (void)baro;

    if (!vega_sensor_bus_valid(&bus)) {
        return -1;
    }

    while (1) {
        /* Wire verified VEGA SDK I2C read/init routines for MPU6050 & BMP280 here */
    }
    return 0;
}
