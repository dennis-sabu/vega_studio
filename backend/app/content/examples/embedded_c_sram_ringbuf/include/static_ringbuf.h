#ifndef STATIC_RINGBUF_H
#define STATIC_RINGBUF_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define RINGBUF_CAPACITY 128u

/* Compile-time guard: capacity must be power-of-two for mask indexing without integer divide on rv32i */
_Static_assert((RINGBUF_CAPACITY & (RINGBUF_CAPACITY - 1u)) == 0u,
               "RINGBUF_CAPACITY must be a power of two");

typedef struct {
    uint8_t buffer[RINGBUF_CAPACITY];
    volatile size_t head;
    volatile size_t tail;
} spsc_ringbuf_t;

static inline void ringbuf_init(spsc_ringbuf_t *rb)
{
    rb->head = 0u;
    rb->tail = 0u;
}

static inline bool ringbuf_push(spsc_ringbuf_t *rb, uint8_t byte)
{
    size_t next = (rb->head + 1u) & (RINGBUF_CAPACITY - 1u);
    if (next == rb->tail) {
        return false; /* Buffer full */
    }
    rb->buffer[rb->head] = byte;
    rb->head = next;
    return true;
}

static inline bool ringbuf_pop(spsc_ringbuf_t *rb, uint8_t *out_byte)
{
    if (rb->head == rb->tail) {
        return false; /* Empty */
    }
    *out_byte = rb->buffer[rb->tail];
    rb->tail = (rb->tail + 1u) & (RINGBUF_CAPACITY - 1u);
    return true;
}

#endif /* STATIC_RINGBUF_H */
