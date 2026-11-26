#ifndef RISCV_CSR_HELPERS_H
#define RISCV_CSR_HELPERS_H

#include <stdint.h>

/*
 * Standard RISC-V Zicsr inline-assembly accessors (rv32i_zicsr).
 * Standard architectural CSR names: mstatus (0x300), mcycle (0xB00), mcycleh (0xB80).
 * Non-RISC-V host builds compile safely cleanly with a stub fallback for conceptual analysis.
 */
static inline uint32_t vega_read_mcycle_low(void)
{
#ifdef __riscv
    uint32_t val;
    __asm__ volatile ("csrr %0, mcycle" : "=r"(val));
    return val;
#else
    return 0u;
#endif
}

static inline uint32_t vega_read_mcycle_high(void)
{
#ifdef __riscv
    uint32_t val;
    __asm__ volatile ("csrr %0, mcycleh" : "=r"(val));
    return val;
#else
    return 0u;
#endif
}

/* Rollover-safe 64-bit cycle read on a 32-bit RISC-V core */
static inline uint64_t vega_read_mcycle64(void)
{
    uint32_t hi1;
    uint32_t lo;
    uint32_t hi2;
    do {
        hi1 = vega_read_mcycle_high();
        lo  = vega_read_mcycle_low();
        hi2 = vega_read_mcycle_high();
    } while (hi1 != hi2);

    return ((uint64_t)hi2 << 32) | (uint64_t)lo;
}

#endif /* RISCV_CSR_HELPERS_H */
