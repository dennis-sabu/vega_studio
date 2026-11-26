#include <stdint.h>
#include "uart_framer.h"

static uart_line_parser_t g_parser;
static volatile uint32_t g_frames_parsed = 0u;
static volatile uint8_t g_last_checksum = 0u;

int main(void)
{
    const char sample[] = "PING,VEGA_ARIES_V3\n";
    uart_parser_reset(&g_parser);

    /* Simulate feeding UART RX bytes into the bounded parser */
    for (size_t i = 0u; sample[i] != '\0'; ++i) {
        if (uart_parser_feed(&g_parser, (uint8_t)sample[i])) {
            g_last_checksum = uart_xor_checksum(g_parser.payload, g_parser.length);
            g_frames_parsed++;
            uart_parser_reset(&g_parser);
        }
    }

    while (1) {
        /* Poll verified VEGA SDK UART RX here and feed uart_parser_feed() */
    }
    return 0;
}
