#include <stdint.h>

enum {
    EVT_TIMER_TICK = (1u << 0),
    EVT_UART_RX    = (1u << 1),
    EVT_SENSOR_RDY = (1u << 2),
};

/* Shared bitmask written by short ISRs and drained safely by main loop */
static volatile uint32_t g_pending_events = 0u;
static volatile uint32_t g_handled_ticks = 0u;

/* Conceptual ISR hook called from a verified VEGA SDK interrupt wrapper */
void on_hardware_event_isr(uint32_t event_bit)
{
    g_pending_events |= event_bit;
}

static void handle_deferred_events(void)
{
    uint32_t snapshot = g_pending_events;
    if (snapshot == 0u) {
        return;
    }
    /* Clear only latched bits cleanly (disable global IRQ briefly using SDK helper in production) */
    g_pending_events &= ~snapshot;

    if ((snapshot & EVT_TIMER_TICK) != 0u) {
        g_handled_ticks++;
    }
}

int main(void)
{
    on_hardware_event_isr(EVT_TIMER_TICK);
    while (1) {
        handle_deferred_events();
    }
    return 0;
}
