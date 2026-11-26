#include <stdint.h>
#include "app_config.h"

/*
 * Freestanding firmware heartbeat counter.
 * Marked volatile so the compiler preserves loop updates cleanly during inspection.
 */
static volatile uint32_t g_heartbeat_ticks = 0u;

int main(void)
{
    uint32_t local_count = 0u;

    while (1) {
        local_count++;
        g_heartbeat_ticks = local_count;
    }

    return 0;
}
