#include <stdint.h>
#include "csr_helpers.h"

static volatile uint64_t g_last_elapsed_cycles = 0u;

int main(void)
{
    uint64_t start = vega_read_mcycle64();
    volatile uint32_t accum = 0u;

    for (uint32_t i = 0u; i < 64u; ++i) {
        accum += i;
    }

    uint64_t end = vega_read_mcycle64();
    g_last_elapsed_cycles = end - start;

    (void)accum;
    while (1) {
        /* Idle firmware loop */
    }
    return 0;
}
