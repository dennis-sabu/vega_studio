#ifndef UART_FRAMER_H
#define UART_FRAMER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define UART_FRAME_MAX_LEN 96u

typedef struct {
    char payload[UART_FRAME_MAX_LEN];
    size_t length;
    bool overflow;
} uart_line_parser_t;

static inline void uart_parser_reset(uart_line_parser_t *p)
{
    p->length = 0u;
    p->overflow = false;
    p->payload[0] = '\0';
}

/* Push one received UART byte; returns true when a bounded LF-terminated line is ready. */
static inline bool uart_parser_feed(uart_line_parser_t *p, uint8_t ch)
{
    if (ch == '\r') {
        return false;
    }
    if (ch == '\n') {
        if (p->overflow) {
            uart_parser_reset(p);
            return false;
        }
        p->payload[p->length] = '\0';
        return p->length > 0u;
    }
    if (p->length + 1u >= UART_FRAME_MAX_LEN) {
        p->overflow = true;
        return false;
    }
    p->payload[p->length++] = (char)ch;
    return false;
}

static inline uint8_t uart_xor_checksum(const char *data, size_t len)
{
    uint8_t cs = 0u;
    for (size_t i = 0u; i < len; ++i) {
        cs ^= (uint8_t)data[i];
    }
    return cs;
}

#endif /* UART_FRAMER_H */
