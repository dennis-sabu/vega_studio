#include <stdint.h>
#include "static_ringbuf.h"

/* Assert our ring buffer takes under 4 KB of the verified 256 KB ARIES V3 SRAM */
_Static_assert(sizeof(spsc_ringbuf_t) < 4096u, "Buffer budget exceeded");

static spsc_ringbuf_t g_rx_fifo;

int main(void)
{
    ringbuf_init(&g_rx_fifo);

    for (uint8_t b = 0u; b < 8u; ++b) {
        (void)ringbuf_push(&g_rx_fifo, (uint8_t)('A' + b));
    }

    uint8_t ch = 0u;
    volatile uint32_t processed = 0u;
    while (ringbuf_pop(&g_rx_fifo, &ch)) {
        processed += ch;
    }

    while (1) {
    }
    return 0;
}
